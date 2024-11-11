const express = require('express');
const router = express.Router();
const db = require('../db');

router.get('/', async (req, res) => {
    try {
        // 재고 현황 조회
        const inventory = await db.all(`
            SELECT 
                i.id,
                i.manufacturer,
                i.item_name,
                i.item_subname,
                i.item_subno,
                ci.warehouse_name,
                ci.warehouse_shelf,
                ci.current_quantity,
                EXISTS(
                    SELECT 1 
                    FROM outbound ob 
                    WHERE ob.item_id = i.id
                ) as has_outbound_history
            FROM 
                items i
            INNER JOIN 
                current_inventory ci ON i.id = ci.item_id
            WHERE
                ci.current_quantity > 0
            ORDER BY
                i.item_name,
                i.item_subname,
                i.manufacturer, 
                ci.warehouse_name,
                ci.warehouse_shelf
        `);

        // 품목별 총 재고 요약
        const summaryData = await db.all(`
            SELECT
                i.item_name,
                i.item_subname,
                i.manufacturer,
                SUM(ci.current_quantity) as total_quantity
            FROM
                items i
            INNER JOIN
                current_inventory ci ON i.id = ci.item_id
            WHERE 
                ci.current_quantity > 0
            GROUP BY
                i.item_name,
                i.item_subname,
                i.manufacturer
            ORDER BY
                i.item_name,
                i.item_subname,
                i.manufacturer
        `);
        
        res.json({
            inventory,
            summary: summaryData
        });
    } catch (error) {
        console.error('Error fetching inventory:', error);
        res.status(500).json({ error: error.message });
    }
});

router.get('/:id', async (req, res) => {
    try {
        const item = await db.get(`
            SELECT 
                i.id, 
                i.manufacturer, 
                i.item_name,
                i.item_subname,
                i.item_subno,
                ci.current_quantity,
                ci.warehouse_name,
                ci.warehouse_shelf
            FROM 
                items i
            LEFT JOIN 
                current_inventory ci ON i.id = ci.item_id
            WHERE
                i.id = $1
            `, [req.params.id]);

        if (!item) {
            return res.status(404).json({ message: 'Item not found' });
        }

        res.json(item);
    } catch (error) {
        console.error('Error fetching item details:', error);
        res.status(500).json({ error: error.message });
    }
});

router.post('/', async (req, res) => {
    try {
        const id = await Inventory.create(req.body);
        res.status(201).json({ id, message: 'Item created successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.delete('/:id', async (req, res) => {
    const { id } = req.params;

    try {
        const result = await db.run(
            'DELETE FROM inbound WHERE id = $1 RETURNING *',
            [id]
        );

        if (result.rowCount === 0) {
            return res.status(404).json({
                success: false,
                error: '삭제할 입고 기록을 찾을 수 없습니다.'
            });
        }

        res.json({ 
            success: true,
            message: '입고 기록이 성공적으로 삭제되었습니다.'
        });
    } catch (error) {
        console.error('Error deleting inbound record:', error);
        res.status(500).json({ 
            success: false,
            error: '입고 기록 삭제 중 오류가 발생했습니다.' 
        });
    }
});

router.get('/inbound/:id', async (req, res) => {
    try {
        const inboundRecord = await db.get(`
            SELECT 
                i.id AS inbound_id,
                to_char(i.date, 'YYYY-MM-DD') as date,
                i.supplier,
                ci.current_quantity as total_quantity,  -- 변경: 입고 수량 대신 현재 재고 수량 사용
                i.handler_name,
                i.warehouse_name,
                i.warehouse_shelf,
                i.description,
                it.id as item_id,
                it.item_name,
                it.item_subname,
                it.item_subno,
                it.manufacturer
            FROM 
                inbound i
                JOIN items it ON i.item_id = it.id
                JOIN current_inventory ci ON it.id = ci.item_id  -- 추가: current_inventory와 JOIN
            WHERE 
                i.id = $1
        `, [req.params.id]);

        if (!inboundRecord) {
            return res.status(404).json({ error: '입고 기록을 찾을 수 없습니다.' });
        }

        // 입고 기록이 있지만 current_inventory에 데이터가 없는 경우를 위한 처리
        if (inboundRecord.total_quantity === null || inboundRecord.total_quantity === undefined) {
            const originalInbound = await db.get(`
                SELECT total_quantity
                FROM inbound
                WHERE id = $1
            `, [req.params.id]);
            
            inboundRecord.total_quantity = originalInbound.total_quantity;
        }

        res.json(inboundRecord);
    } catch (error) {
        console.error('Error fetching inbound record:', error);
        res.status(500).json({ error: '입고 기록 조회 중 오류가 발생했습니다.' });
    }
});

router.patch('/inbound/:id', async (req, res) => {
    const { id } = req.params;
    const {
        total_quantity: newQuantity,
        warehouse_name: newWarehouseName,
        warehouse_shelf: newWarehouseShelf,
        description
    } = req.body;

    try {
        await db.runTransaction(async (client) => {
            // 1. 현재 입고 기록과 관련 출고 내역 확인
            const currentState = await client.query(`
                WITH current_inbound AS (
                    SELECT 
                        i.*,
                        COALESCE(
                            (SELECT SUM(total_quantity) 
                            FROM outbound 
                            WHERE item_id = i.item_id 
                            AND warehouse_name = i.warehouse_name
                            AND warehouse_shelf = i.warehouse_shelf
                            AND date >= i.date), 
                            0
                        ) as related_outbound
                    FROM inbound i
                    WHERE i.id = $1
                )
                SELECT *,
                    (SELECT current_quantity 
                     FROM current_inventory 
                     WHERE item_id = ci.item_id 
                     AND warehouse_name = ci.warehouse_name 
                     AND warehouse_shelf = ci.warehouse_shelf
                    ) as location_stock
                FROM current_inbound ci
            `, [id]);

            if (!currentState.rows[0]) {
                throw new Error('입고 기록을 찾을 수 없습니다.');
            }

            const current = currentState.rows[0];

            // 2. 수정 가능 여부 검증
            if (current.description?.includes('[취소됨]')) {
                throw new Error('취소된 입고 건은 수정할 수 없습니다.');
            }

            if (newQuantity && newQuantity < current.related_outbound) {
                throw new Error(`이 입고 건과 관련된 출고 수량(${current.related_outbound})보다 적은 수량으로 수정할 수 없습니다.`);
            }

            // 3. 입고 기록 업데이트
            const updateResult = await client.query(`
                UPDATE inbound 
                SET 
                    total_quantity = COALESCE($1, total_quantity),
                    warehouse_name = COALESCE($2, warehouse_name),
                    warehouse_shelf = COALESCE($3, warehouse_shelf),
                    description = CASE 
                        WHEN $4 IS NOT NULL THEN $4 
                        ELSE description 
                    END,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = $5
                RETURNING *
            `, [
                newQuantity,
                newWarehouseName,
                newWarehouseShelf,
                description,
                id
            ]);

            if (!updateResult.rows[0]) {
                throw new Error('입고 기록 업데이트에 실패했습니다.');
            }
        });

        res.json({
            success: true,
            message: '입고 정보가 성공적으로 수정되었습니다.'
        });
    } catch (error) {
        console.error('Error updating inbound:', error);
        res.status(500).json({
            success: false,
            error: '입고 수정 중 오류가 발생했습니다.',
            details: error.message
        });
    }
});

// router.put('/inbound/:id', async (req, res) => {
//     const { id } = req.params;
//     const {
//         date,
//         supplier,
//         total_quantity,
//         warehouse_name,
//         warehouse_shelf,
//         description
//     } = req.body;

//     try {
//         await db.runTransaction(async (client) => {
//             // 1. 현재 입고 기록과 재고 상태 확인
//             const currentState = await client.query(`
//                 SELECT 
//                     inb.id as inbound_id,
//                     inb.item_id,
//                     inb.total_quantity as original_quantity,
//                     COALESCE(ci.current_quantity, 0) as current_quantity
//                 FROM 
//                     inbound inb
//                     LEFT JOIN current_inventory ci ON inb.item_id = ci.item_id
//                 WHERE 
//                     inb.id = $1
//             `, [id]);

//             if (!currentState.rows[0]) {
//                 throw new Error('입고 기록을 찾을 수 없습니다.');
//             }

//             const currentRecord = currentState.rows[0];
//             const newQuantity = parseInt(total_quantity);

//             if (isNaN(newQuantity)) {
//                 throw new Error('유효하지 않은 수량입니다.');
//             }

//             // 2. 재고 변동량 체크
//             if (newQuantity < currentRecord.current_quantity) {
//                 throw new Error(`현재 재고 수량(${currentRecord.current_quantity})보다 적은 수량으로 수정할 수 없습니다.`);
//             }

//             // 3. 입고 기록 업데이트
//             const updateResult = await client.query(`
//                 UPDATE inbound 
//                 SET 
//                     date = $1,
//                     supplier = $2,
//                     total_quantity = $3,
//                     warehouse_name = $4,
//                     warehouse_shelf = $5,
//                     description = $6
//                 WHERE id = $7
//                 RETURNING *
//             `, [
//                 new Date(date).toISOString(),
//                 supplier,
//                 newQuantity,
//                 warehouse_name || '',
//                 warehouse_shelf || '',  // null 대신 빈 문자열 사용
//                 description || '',
//                 id
//             ]);

//             if (!updateResult.rows[0]) {
//                 throw new Error('입고 기록 업데이트에 실패했습니다.');
//             }

//             // 4. 재고 감사 로그 추가
//             // await client.query(`
//             //     INSERT INTO inventory_audit (
//             //         item_id,
//             //         operation_type,
//             //         quantity_change,
//             //         previous_quantity,
//             //         new_quantity,
//             //         reference_id,
//             //         reference_type,
//             //         description
//             //     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
//             // `, [
//             //     currentRecord.item_id,
//             //     'inbound_update',
//             //     newQuantity - currentRecord.original_quantity,
//             //     currentRecord.current_quantity,
//             //     currentRecord.current_quantity + (newQuantity - currentRecord.original_quantity),
//             //     id,
//             //     'inbound',
//             //     '입고 수량 수정'
//             // ]);
//         });

//         res.json({
//             success: true,
//             message: '입고 기록이 성공적으로 수정되었습니다.'
//         });
//     } catch (error) {
//         console.error('Error updating inbound record:', error);
//         res.status(500).json({ 
//             success: false,
//             error: '입고 기록 수정 중 오류가 발생했습니다.',
//             details: error.message
//         });
//     }
// });

module.exports = router;