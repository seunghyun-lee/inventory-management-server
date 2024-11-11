const express = require('express');
const router = express.Router();
const ExcelJS = require('exceljs');
const db = require('../db');

router.get('/export-excel', async (req, res) => {
    try {
        const { startDate, endDate } = req.query;
        
        const inboundData = await db.all(`
            SELECT 
                'inbound' as type,
                i.date, 
                i.supplier as company,
                it.item_name,
                i.total_quantity,
                it.item_subname,
                it.manufacturer,
                i.warehouse_name,
                i.warehouse_shelf,
                i.description,
                i.handler_name
            FROM inbound i
            JOIN items it ON i.item_id = it.id
            WHERE i.date BETWEEN $1 AND $2
        `, [startDate, endDate]);

        const outboundData = await db.all(`
            SELECT 
                'outbound' as type,
                o.date, 
                o.client as company,
                it.item_name,
                o.total_quantity,
                it.item_subname,
                it.manufacturer,
                o.warehouse_name,
                o.warehouse_shelf,
                o.description,
                o.handler_name
            FROM outbound o
            JOIN items it ON o.item_id = it.id
            WHERE o.date BETWEEN $1 AND $2
        `, [startDate, endDate]);

        const allData = [...inboundData, ...outboundData].sort((a, b) => new Date(a.date) - new Date(b.date));

        // Excel 워크북 생성
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Inventory Report');
        
        // 헤더 추가
        const headerRow = worksheet.addRow(['날짜', '구분', '회사', '물품명', '수량', '뒷부호', '메이커', '창고', '위치', '메모', '담당자']);

        // 헤더 스타일 적용
        headerRow.eachCell((cell) => {
            cell.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FF87CEEB' }  // 하늘색 (SkyBlue)
            };
            cell.font = { bold: true };
            cell.alignment = { vertical: 'middle', horizontal: 'center' };
            cell.border = {
                top: { style: 'thin', color: { argb: 'FF000000' } },
                left: { style: 'thin', color: { argb: 'FF000000' } },
                bottom: { style: 'thin', color: { argb: 'FF000000' } },
                right: { style: 'thin', color: { argb: 'FF000000' } }
            };
        });

        allData.forEach((item, index) => {
            const row = worksheet.addRow([
                item.date,
                item.type === 'inbound' ? '입고' : '출고',
                item.company,
                item.item_name,
                item.type === 'outbound' ? -item.total_quantity : item.total_quantity,
                item.item_subname,
                item.manufacturer,
                item.warehouse_name,
                item.warehouse_shelf,
                item.description,
                item.handler_name
            ]);

            if (item.type === 'outbound') {
                row.font = { color: { argb: 'FFFF0000' } };
            }

            row.eachCell((cell) => {
                cell.alignment = { vertical: 'middle', horizontal: 'center' };
                cell.border = {
                    top: { style: 'thin', color: { argb: 'FF000000' } },
                    left: { style: 'thin', color: { argb: 'FF000000' } },
                    bottom: { style: 'thin', color: { argb: 'FF000000' } },
                    right: { style: 'thin', color: { argb: 'FF000000' } }
                };
            });
        });

        worksheet.columns.forEach(column => {
            column.width = 15;
        });
        
        const now = new Date();
        const filename = `inventory_report_${now.getFullYear()}${(now.getMonth() + 1).toString().padStart(2, '0')}${now.getDate().toString().padStart(2, '0')}.xlsx`;
        const encodedFilename = encodeURIComponent(filename);

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${encodedFilename}"; filename*=UTF-8''${encodedFilename}`);

        await workbook.xlsx.write(res);
        res.end();
    } catch (error) {
        console.error('Error generating Excel file:', error);
        res.status(500).json({ error: 'Excel 파일 생성 중 오류가 발생했습니다.' });
    }
});

module.exports = router;