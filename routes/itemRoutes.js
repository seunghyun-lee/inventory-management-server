const express = require('express');
const router = express.Router();
const db = require('../db');
// const multer = require('multer');
// const { parse } = require('csv-parse');
// const fs = require('fs');

// const upload = multer({ dest: 'uploads/' });

// router.post('/upload', upload.single('file'), async (req, res) => {
//     if (!req.file) {
//         return res.status(400).json({ success: false, error: '파일이 업로드되지 않았습니다.' });
//     }

//     const results = [];
    
//     // UTF-8 with BOM으로 파일 읽기
//     const fileContent = fs.readFileSync(req.file.path, 'utf8')
//         .replace(/^\uFEFF/, '');  // BOM 제거
    
//     console.log('File content first line:', fileContent.split('\n')[0]);
    
//     parse(fileContent, {
//         delimiter: ',',
//         columns: true,
//         trim: true,
//         skip_empty_lines: true
//     }, (err, records) => {
//         if (err) {
//             console.error('Parsing error:', err);
//             return res.status(500).json({
//                 success: false,
//                 error: 'CSV 파일 파싱 중 오류가 발생했습니다.'
//             });
//         }

//         // 실제 헤더 확인
//         console.log('Headers:', records.length > 0 ? Object.keys(records[0]) : 'No records');
//         console.log('First record:', records.length > 0 ? records[0] : 'No records');

//         records.forEach(data => {
//             // 실제 키 이름으로 접근
//             const keys = Object.keys(data);
//             const itemNameKey = keys.find(k => k.includes('물품명') || k.endsWith('명'));
//             const subNameKey = keys.find(k => k.includes('뒷부호') || k.includes('부호'));
//             const manufacturerKey = keys.find(k => k.includes('메이커') || k.includes('커'));

//             if (itemNameKey && data[itemNameKey]) {
//                 const item = {
//                     item_name: data[itemNameKey].trim(),
//                     item_subname: subNameKey && data[subNameKey] ? data[subNameKey].trim() : null,
//                     manufacturer: manufacturerKey && data[manufacturerKey] ? data[manufacturerKey].trim() : '비어 있음'
//                 };
//                 console.log('Processing item:', item);
//                 results.push(item);
//             }
//         });

//         processBatch();
//     });

//     const processBatch = async () => {
//         try {
//             console.log('Total items to process:', results.length);
            
//             if (results.length === 0) {
//                 return res.status(400).json({
//                     success: false,
//                     error: '처리할 데이터가 없습니다.'
//                 });
//             }

//             const values = results.map((_, index) => {
//                 const offset = index * 3;
//                 return `($${offset + 1}, $${offset + 2}, $${offset + 3})`;
//             }).join(', ');

//             const params = results.flatMap(item => [
//                 item.item_name,
//                 item.item_subname,
//                 item.manufacturer
//             ]);

//             console.log('First few parameters:', params.slice(0, 9));

//             const query = `
//                 INSERT INTO items (item_name, item_subname, manufacturer)
//                 VALUES ${values}
//                 ON CONFLICT (manufacturer, item_name, item_subname, item_subno) 
//                 DO NOTHING
//                 RETURNING *;
//             `;

//             const result = await db.run(query, params);
            
//             // 임시 파일 삭제
//             fs.unlink(req.file.path, (err) => {
//                 if (err) console.error('Error deleting temp file:', err);
//             });

//             res.json({
//                 success: true,
//                 message: '데이터가 성공적으로 업로드되었습니다.',
//                 count: result.rowCount || 0,
//                 totalProcessed: results.length
//             });
//         } catch (error) {
//             console.error('Error inserting data:', error);
//             res.status(500).json({
//                 success: false,
//                 error: '데이터 삽입 중 오류가 발생했습니다.',
//                 details: error.message
//             });
//         }
//     };
// });

router.get('/', async (req, res) => {
    try {
        const items = await db.all(`
            WITH parsed_items AS (
                SELECT 
                    id,
                    item_name,
                    item_subname,
                    item_subno,
                    manufacturer,
                    price,
                    REGEXP_REPLACE(item_name, '[^0-9]', '', 'g') AS numeric_part,
                    REGEXP_REPLACE(item_name, '[0-9]', '', 'g') AS text_part
                FROM items
            )
            SELECT 
                id,
                item_name,
                item_subname,
                item_subno,
                manufacturer,
                price
            FROM parsed_items
            ORDER BY 
                text_part,
                CASE 
                    WHEN numeric_part ~ '^[0-9]+$' 
                    THEN CAST(numeric_part AS BIGINT)
                    ELSE NULL 
                END NULLS LAST,
                item_name,
                item_subname NULLS LAST,
                item_subno NULLS LAST
        `);
        res.json(items);
    } catch (error) {
        console.error('Error fetching items:', error);
        res.status(500).json({ error: '품목 목록을 가져오는데 실패했습니다.' });
    }
});

router.post('/', async (req, res) => {
    const { manufacturer, item_name, item_subname, item_subno, price } = req.body;
    try {
        const result = await db.run(
            'INSERT INTO items (manufacturer, item_name, item_subname, item_subno, price) VALUES ($1, $2, $3, $4, $5) RETURNING *',
            [manufacturer, item_name, item_subname, item_subno, price]
        );
        res.status(201).json(result);
    } catch (error) {
        console.error('Error adding item:', error);
        res.status(500).json({ error: '품목 추가에 실패했습니다.' });
    }
});

router.put('/:id', async (req, res) => {
    const { id } = req.params;
    const { manufacturer, item_name, item_subname, item_subno, price } = req.body;
    try {
        const existingItem = await db.run(
            'SELECT id FROM items WHERE id = $1',
            [id]
        );

        if (existingItem.rowCount === 0) {
            return res.status(404).json({
                success: false,
                error: '해당 ID의 품목을 찾을 수 없습니다.'
            });
        }

        const result = await db.run(
            `UPDATE items
            SET manufacturer = $1,
                item_name = $2,
                item_subname = $3,
                item_subno = $4,
                price = $5
            WHERE id = $6
            RETURNING *
            `,
            [manufacturer, item_name, item_subname, item_subno, price, id]
        );

        if (result.rowCount === 0) {
            return res.status(404).json({
                success: false,
                error: '품목 업데이트에 실패했습니다.'
            });
        }

        res.json({
            success: true,
            message: '품목이 성공적으로 수정되었습니다.',
            data: result
        });
    } catch (error) {
        console.error('Error updating item:', error);
        res.status(500).json({ 
            success: false,
            error: '품목 수정에 실패했습니다.',
            details: error.message 
        });
    }
});

router.delete('/:id', async (req, res) => {
    const { id } = req.params;
    try {
        await db.run('DELETE FROM items WHERE id = $1', [id]);
        res.json({ message: '품목이 삭제되었습니다.'});
    } catch (error) {
        console.error('Error deleting item:', error);
        res.status(500).json({ error: '품목 삭제에 실패했습니다.' });
    }
});

module.exports = router;