const express = require('express');
const router = express.Router();
const db = require('../db');

router.get('/', async (req, res) => {
    try {
        // 재고 현황 조회
        const inventory = await db.all(`
            SELECT 
                i.id as item_id,
                ci.id as inventory_id,
                i.manufacturer,
                i.item_name,
                i.item_subname,
                i.item_subno,
                ci.warehouse_name,
                ci.warehouse_shelf,
                ci.current_quantity
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
        const inventory = await db.get(`
            SELECT 
                ci.id as inventory_id,
                i.id as item_id,
                i.manufacturer,
                i.item_name,
                i.item_subname,
                i.item_subno,
                ci.warehouse_name,
                ci.warehouse_shelf,
                ci.current_quantity
            FROM 
                current_inventory ci
            INNER JOIN 
                items i ON ci.item_id = i.id
            WHERE 
                ci.id = $1
        `, [req.params.id]);

        if (!inventory) {
            return res.status(404).json({ message: '재고를 찾을 수 없습니다' });
        }

        res.json(inventory);
    } catch (error) {
        console.error('Error fetching inventory details:', error);
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
        await db.runTransaction(async (client) => {
            // 1. 현재 입고 기록 조회
            const currentInbound = await client.query(
                'SELECT * FROM inbound WHERE id = $1',
                [id]
            );

            if (!currentInbound.rows[0]) {
                throw new Error('삭제할 입고 기록을 찾을 수 없습니다.');
            }

            const inbound = currentInbound.rows[0];

            // 2. 재고 조정
            await db.updateInventory(client, {
                item_id: inbound.item_id,
                warehouse_name: inbound.warehouse_name,
                warehouse_shelf: inbound.warehouse_shelf,
                quantity_change: -inbound.total_quantity,
                operation_type: 'inbound_delete',
                reference_id: id,
                description: '입고 삭제'
            });

            // 3. 입고 기록 삭제
            await client.query('DELETE FROM inbound WHERE id = $1', [id]);
        });

        res.json({ 
            success: true,
            message: '입고 기록이 성공적으로 삭제되었습니다.'
        });
    } catch (error) {
        console.error('Error deleting inbound record:', error);
        res.status(500).json({ 
            success: false,
            error: '입고 기록 삭제 중 오류가 발생했습니다.',
            details: error.message
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
        warehouse_name,
        warehouse_shelf,
        description
    } = req.body;

    try {
        await db.runTransaction(async (client) => {
            // 1. 현재 입고 기록 조회
            const currentInbound = await client.query(`
                SELECT 
                    i.*,
                    it.item_name,
                    it.manufacturer,
                    it.item_subname,
                    it.item_subno
                FROM inbound i
                JOIN items it ON i.item_id = it.id
                WHERE i.id = $1
            `, [id]);

            if (!currentInbound.rows[0]) {
                throw new Error('입고 기록을 찾을 수 없습니다.');
            }

            const current = currentInbound.rows[0];

            // 2. 수정 가능 여부 검증
            if (current.description?.includes('[취소됨]')) {
                throw new Error('취소된 입고 건은 수정할 수 없습니다.');
            }

            // 현재 위치의 출고 내역 확인
            const outboundSum = await client.query(`
                SELECT COALESCE(SUM(total_quantity), 0) as total_outbound
                FROM outbound
                WHERE item_id = $1 
                AND warehouse_name = $2
                AND warehouse_shelf = $3
                AND date >= $4
            `, [current.item_id, current.warehouse_name, current.warehouse_shelf, current.date]);

            const totalOutbound = parseInt(outboundSum.rows[0].total_outbound);

            if (newQuantity && newQuantity < totalOutbound) {
                throw new Error(`이 입고 건과 관련된 출고 수량(${totalOutbound})보다 적은 수량으로 수정할 수 없습니다.`);
            }

            // 3. 재고 업데이트
            if (newQuantity && newQuantity !== current.total_quantity) {
                await db.updateInventory(client, {
                    item_id: current.item_id,
                    warehouse_name: warehouse_name || current.warehouse_name,
                    warehouse_shelf: warehouse_shelf || current.warehouse_shelf,
                    quantity_change: newQuantity - current.total_quantity,
                    operation_type: 'inbound_update',
                    reference_id: id,
                    description: description || '입고 수량 수정'
                });
            }

            // 4. 입고 기록 업데이트
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
                warehouse_name,
                warehouse_shelf,
                description,
                id
            ]);

            return updateResult.rows[0];
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

module.exports = router;