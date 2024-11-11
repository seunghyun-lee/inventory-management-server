const express = require('express');
const router = express.Router();
const db = require('../db');

router.get('/', async (req, res) => {
    const { startDate, endDate } = req.query;
    
    try {
        let query = `
            WITH combined_data AS (
                SELECT
                    'inbound' as type,
                    i.id as item_id, 
                    ib.id as record_id,
                    i.manufacturer, 
                    i.item_name, 
                    i.item_subname, 
                    i.item_subno, 
                    ib.date,
                    ib.supplier as company,
                    ib.total_quantity,
                    ib.handler_name,
                    ib.warehouse_name,
                    ib.warehouse_shelf,
                    ib.description,
                    COALESCE(ib.created_at, ib.date) as created_at,
                    COALESCE(ib.updated_at, ib.date) as updated_at
                FROM
                    items i
                INNER JOIN
                    inbound ib ON i.id = ib.item_id
                WHERE 1=1
                ${startDate && endDate ? `AND ib.date BETWEEN $1 AND $2` : `AND ib.date >= (CURRENT_DATE - INTERVAL '6 months')`}
                
                UNION ALL
                
                SELECT
                    'outbound' as type,
                    i.id as item_id,
                    ob.id as record_id,
                    i.manufacturer, 
                    i.item_name, 
                    i.item_subname, 
                    i.item_subno, 
                    ob.date,
                    ob.client as company,
                    ob.total_quantity,
                    ob.handler_name,
                    ob.warehouse_name,
                    ob.warehouse_shelf,
                    ob.description,
                    ob.created_at,
                    ob.updated_at
                FROM
                    items i
                INNER JOIN
                    outbound ob ON i.id = ob.item_id
                WHERE 1=1
                ${startDate && endDate ? `AND ob.date BETWEEN $1 AND $2` : `AND ob.date >= (CURRENT_DATE - INTERVAL '6 months')`}
            )
            SELECT 
                type,
                item_id,
                record_id as id,
                manufacturer,
                item_name,
                item_subname,
                item_subno,
                date,
                company,
                total_quantity,
                handler_name,
                warehouse_name,
                warehouse_shelf,
                description
            FROM combined_data
            ORDER BY 
                date DESC,
                created_at DESC,
                updated_at DESC,
                record_id DESC
        `;

        const params = startDate && endDate ? [startDate, endDate] : [];
        
        console.log('Executing query:', query);
        console.log('Parameters:', params);
        
        const result = await db.query(query, params);
        
        if (!result || (!result.rows && !Array.isArray(result))) {
            throw new Error('No results returned from database');
        }
        
        const history = result;
        console.log(`Found ${history.length} records`);
        
        res.json(history);
    } catch (error) {
        console.error('Error details:', error);
        res.status(500).json({ 
            error: 'Internal server error', 
            details: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined 
        });
    }
});

router.delete('/outbound/:id', async (req, res) => {
    const { id } = req.params;
    
    try {
        let deletedRecord = null;

        await db.runTransaction(async (client) => {
            // 1. 출고 기록 조회
            const outboundResult = await client.query(`
                SELECT 
                    o.*,
                    i.item_name,
                    i.manufacturer,
                    i.item_subname,
                    i.item_subno
                FROM outbound o
                JOIN items i ON o.item_id = i.id
                WHERE o.id = $1
            `, [id]);

            if (!outboundResult.rows || outboundResult.rows.length === 0) {
                throw new Error(`출고 기록을 찾을 수 없습니다. (ID: ${id})`);
            }

            const outboundRecord = outboundResult.rows[0];

            // 2. 현재 재고 상태 확인
            const inventoryResult = await client.query(`
                SELECT current_quantity 
                FROM current_inventory 
                WHERE item_id = $1
            `, [outboundRecord.item_id]);

            const currentQuantity = parseInt(inventoryResult.rows[0]?.current_quantity || 0);
            const quantityToAdd = parseInt(outboundRecord.total_quantity);
            const newQuantity = currentQuantity + quantityToAdd;

            console.log('Current quantity:', currentQuantity);
            console.log('Quantity to add back:', quantityToAdd);
            console.log('New quantity will be:', newQuantity);

            // 3. 출고 기록 삭제
            await client.query(
                'DELETE FROM outbound WHERE id = $1',
                [id]
            );

            // 4. 재고 감사 로그 추가 (description 컬럼 제외)
            await client.query(`
                INSERT INTO inventory_audit (
                    item_id,
                    operation_type,
                    quantity_change,
                    previous_quantity,
                    new_quantity,
                    reference_id,
                    reference_type,
                    description
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            `, [
                outboundRecord.item_id,
                'outbound_delete',
                quantityToAdd,
                currentQuantity,
                newQuantity,
                id,
                'outbound',
                '출고 취소로 인한 재고 반환'
            ]);

            deletedRecord = {
                ...outboundRecord,
                previous_quantity: currentQuantity,
                new_quantity: newQuantity
            };
        });

        res.json({ 
            success: true,
            message: '출고 기록이 삭제되었습니다.',
            data: {
                deletedRecord,
                message: `${deletedRecord.total_quantity}개가 재고로 반환되었습니다.`,
                previousQuantity: deletedRecord.previous_quantity,
                newQuantity: deletedRecord.new_quantity
            }
        });
    } catch (error) {
        console.error('Detailed error:', error);
        res.status(500).json({ 
            error: '출고 기록 삭제 중 오류가 발생했습니다.',
            details: error.message
        });
    }
});

router.patch('/outbound/:id', async (req, res) => {
    const { id } = req.params;
    const { total_quantity: newQuantity, description } = req.body;

    try {
        let updatedRecord = null;

        await db.runTransaction(async (client) => {
            // 1. 현재 출고 기록과 재고 상태 조회
            const currentState = await client.query(`
                WITH current_outbound AS (
                    SELECT o.*, i.item_name, i.manufacturer, i.item_subname, i.item_subno
                    FROM outbound o 
                    JOIN items i ON o.item_id = i.id 
                    WHERE o.id = $1
                ),
                current_inventory AS (
                    SELECT 
                        i.id,
                        COALESCE(SUM(ib.total_quantity), 0) as total_inbound,
                        COALESCE(SUM(CASE WHEN ob.id != $1 THEN ob.total_quantity ELSE 0 END), 0) as other_outbound
                    FROM items i
                    LEFT JOIN inbound ib ON i.id = ib.item_id
                    LEFT JOIN outbound ob ON i.id = ob.item_id
                    WHERE i.id = (SELECT item_id FROM current_outbound)
                    GROUP BY i.id
                )
                SELECT 
                    co.*,
                    ci.total_inbound,
                    ci.other_outbound,
                    ci.total_inbound - ci.other_outbound as available_quantity
                FROM current_outbound co
                JOIN current_inventory ci ON co.item_id = ci.id
            `, [id]);

            if (!currentState.rows[0]) {
                throw new Error('출고 기록을 찾을 수 없습니다.');
            }

            const current = currentState.rows[0];
            const totalAvailable = current.available_quantity + current.total_quantity;

            if (newQuantity > totalAvailable) {
                throw new Error(`수정하려는 출고 수량(${newQuantity})이 가용 재고(${totalAvailable})보다 많습니다.`);
            }

            // 2. 출고 기록 수정
            const updateResult = await client.query(`
                UPDATE outbound 
                SET 
                    total_quantity = $1,
                    description = $2,
                    updated_at = CURRENT_TIMESTAMP 
                WHERE id = $3 
                RETURNING *
            `, [newQuantity, description || '', id]);

            if (!updateResult.rows[0]) {
                throw new Error('출고 기록 업데이트에 실패했습니다.');
            }

            // 3. 현재 재고 상태 조회
            const newInventoryState = await client.query(`
                SELECT current_quantity 
                FROM current_inventory 
                WHERE item_id = $1
            `, [current.item_id]);

            updatedRecord = {
                ...updateResult.rows[0],
                item_name: current.item_name,
                manufacturer: current.manufacturer,
                item_subname: current.item_subname,
                item_subno: current.item_subno,
                previous_quantity: current.total_quantity,
                returnedQuantity: current.total_quantity - newQuantity,
                current_quantity: newInventoryState.rows[0]?.current_quantity || 0
            };

            // 4. 재고 감사 로그 추가
            await client.query(`
                INSERT INTO inventory_audit (
                    item_id,
                    operation_type,
                    quantity_change,
                    previous_quantity,
                    new_quantity,
                    reference_id,
                    reference_type
                ) VALUES ($1, $2, $3, $4, $5, $6, $7)
            `, [
                current.item_id,
                'outbound_update',
                newQuantity - current.total_quantity,
                current.available_quantity,
                current.available_quantity + (current.total_quantity - newQuantity),
                id,
                'outbound'
            ]);
        });

        res.json({
            success: true,
            message: '출고 수량이 수정되었습니다.',
            data: updatedRecord
        });
    } catch (error) {
        console.error('Error updating outbound quantity:', error);
        res.status(500).json({ 
            error: '출고 수량 수정 중 오류가 발생했습니다.',
            details: error.message
        });
    }
});

// 입고 취소
router.post('/inbound/:id/cancel', async (req, res) => {
    const { id } = req.params;

    try {
        let cancelledRecord = null;
        
        await db.runTransaction(async (client) => {
            // 1. 해당 입고 건과 관련된 모든 정보 조회
            const inboundResult = await client.query(`
                WITH outbound_summary AS (
                    SELECT 
                        item_id,
                        SUM(total_quantity) as total_outbound,
                        MAX(created_at) as last_outbound_date
                    FROM outbound
                    GROUP BY item_id
                ),
                inventory_status AS (
                    SELECT 
                        i.id,
                        i.item_id,
                        i.total_quantity as inbound_quantity,
                        COALESCE(o.total_outbound, 0) as total_outbound,
                        EXISTS (
                            SELECT 1 
                            FROM inbound later_inbound 
                            WHERE later_inbound.item_id = i.item_id 
                            AND (later_inbound.date > i.date 
                                OR (later_inbound.date = i.date AND later_inbound.created_at > i.created_at))
                        ) as has_later_inbound,
                        (
                            SELECT COALESCE(SUM(ob.total_quantity), 0)
                            FROM outbound ob
                            WHERE ob.item_id = i.item_id
                            AND ob.created_at > i.created_at
                        ) as subsequent_outbound,
                        cv.current_quantity as current_stock
                    FROM inbound i
                    LEFT JOIN outbound_summary o ON i.item_id = o.item_id
                    LEFT JOIN current_inventory cv ON i.item_id = cv.item_id
                    WHERE i.id = $1
                )
                SELECT 
                    i.*,
                    it.item_name,
                    it.manufacturer,
                    it.item_subname,
                    it.item_subno,
                    inv.total_outbound,
                    inv.has_later_inbound,
                    inv.subsequent_outbound,
                    inv.current_stock
                FROM inbound i
                JOIN items it ON i.item_id = it.id
                JOIN inventory_status inv ON i.id = inv.id
                WHERE i.id = $1
            `, [id]);

            if (!inboundResult.rows[0]) {
                throw new Error('입고 기록을 찾을 수 없습니다.');
            }

            const inbound = inboundResult.rows[0];

            // 2. 취소 가능 여부 검증
            if (inbound.description?.includes('[취소됨]')) {
                throw new Error('이미 취소된 입고 기록입니다.');
            }

            if (inbound.subsequent_outbound > 0) {
                throw new Error('이 입고 건 이후에 발생한 출고 내역이 있어 취소할 수 없습니다.');
            }

            if (inbound.has_later_inbound) {
                throw new Error('이후의 입고 건이 존재하여 취소할 수 없습니다.');
            }

            if (inbound.current_stock < inbound.total_quantity) {
                throw new Error('현재 재고가 부족하여 입고를 취소할 수 없습니다.');
            }

            // 3. 입고 기록 업데이트 (description에 취소 표시)
            const updateResult = await client.query(`
                UPDATE inbound
                SET 
                    description = CASE 
                        WHEN description IS NULL OR description = '' 
                        THEN '[취소됨]' 
                        ELSE description || ' [취소됨]'
                    END,
                    total_quantity = 0,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = $1
                RETURNING *
            `, [id]);

            // 4. 재고 감사 로그 추가
            await client.query(`
                INSERT INTO inventory_audit (
                    item_id,
                    operation_type,
                    quantity_change,
                    previous_quantity,
                    new_quantity,
                    reference_id,
                    reference_type,
                    description
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            `, [
                inbound.item_id,
                'inbound_cancel',
                -inbound.total_quantity,
                inbound.current_stock,
                inbound.current_stock - inbound.total_quantity,
                id,
                'inbound',
                '입고 취소'
            ]);

            cancelledRecord = {
                ...updateResult.rows[0],
                previous_quantity: inbound.current_stock,
                new_quantity: inbound.current_stock - inbound.total_quantity
            };
        });

        res.json({
            success: true,
            message: '입고가 취소되었습니다.',
            data: cancelledRecord
        });
    } catch (error) {
        console.error('Error cancelling inbound:', error);
        res.status(500).json({
            error: '입고 취소 중 오류가 발생했습니다.',
            details: error.message
        });
    }
});

// 입고 수정
router.patch('/inbound/:id', async (req, res) => {
    const { id } = req.params;
    const { total_quantity: newQuantity, description, warehouse_name, warehouse_shelf } = req.body;

    try {
        let updatedRecord = null;

        const parsedQuantity = parseInt(newQuantity, 10);
        if (isNaN(parsedQuantity)) {
            throw new Error('유효하지 않은 수량입니다.');
        }

        await db.runTransaction(async (client) => {
            // 1. 현재 입고 상태와 관련된 모든 정보 조회
            const currentState = await client.query(`
                WITH outbound_summary AS (
                    SELECT 
                        o.item_id,
                        SUM(o.total_quantity) as total_outbound,
                        MAX(o.created_at) as last_outbound_date
                    FROM outbound o
                    GROUP BY o.item_id
                ),
                inventory_status AS (
                    SELECT 
                        i.id,
                        i.item_id,
                        i.total_quantity as original_quantity,
                        COALESCE(os.total_outbound, 0) as total_outbound,
                        (
                            SELECT COALESCE(SUM(ob.total_quantity), 0)
                            FROM outbound ob
                            WHERE ob.item_id = i.item_id
                            AND ob.created_at > i.created_at
                        ) as subsequent_outbound,
                        cv.current_quantity as current_stock
                    FROM inbound i
                    LEFT JOIN outbound_summary os ON i.item_id = os.item_id
                    LEFT JOIN current_inventory cv ON i.item_id = cv.item_id
                    WHERE i.id = $1
                )
                SELECT 
                    i.*,
                    it.item_name,
                    it.manufacturer,
                    it.item_subname,
                    it.item_subno,
                    inv.total_outbound,
                    inv.subsequent_outbound,
                    inv.current_stock
                FROM inbound i
                JOIN items it ON i.item_id = it.id
                JOIN inventory_status inv ON i.id = inv.id
                WHERE i.id = $1
            `, [id]);

            if (!currentState.rows[0]) {
                throw new Error('입고 기록을 찾을 수 없습니다.');
            }

            const current = currentState.rows[0];

            const oldQuantity = parseInt(current.total_quantity, 10);
            const newQty = parseInt(newQuantity, 10);

            if (isNaN(newQty)) {
                throw new Error('유효하지 않은 수량입니다.');
            }

            const quantityDiff = newQty - oldQuantity;

            // 2. 수정 가능 여부 검증
            if (current.description?.includes('[취소됨]')) {
                throw new Error('취소된 입고 건은 수정할 수 없습니다.');
            }

            if (newQty < current.subsequent_outbound) {
                throw new Error(`이 입고 건 이후 발생한 출고 수량(${current.subsequent_outbound})보다 적은 수량으로 수정할 수 없습니다.`);
            }

            if (current.current_stock + quantityDiff < 0) {
                throw new Error('현재 재고 수량이 부족하여 입고 수량을 수정할 수 없습니다.');
            }

            // 3. 입고 기록 수정
            const updateResult = await client.query(`
                UPDATE inbound
                SET
                    total_quantity = $1,
                    description = COALESCE($2, description),
                    warehouse_name = COALESCE($3, warehouse_name),
                    warehouse_shelf = COALESCE($4, warehouse_shelf),
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = $5
                RETURNING *
            `, [newQty, description, warehouse_name, warehouse_shelf, id]);

            // 4. 수량이 변경된 경우에만 재고 감사 로그 추가
            if (quantityDiff !== 0) {
                await client.query(`
                    INSERT INTO inventory_audit (
                        item_id,
                        operation_type,
                        quantity_change,
                        previous_quantity,
                        new_quantity,
                        reference_id,
                        reference_type,
                        description
                    ) VALUES ($1, $2, $3::integer, $4::integer, $5::integer, $6, $7, $8)
                `, [
                    parseInt(current.item_id, 10),         // item_id를 정수로 변환
                    'inbound_update',
                    parseInt(quantityDiff, 10),            // quantity_change를 정수로 변환
                    parseInt(current.current_stock, 10),    // previous_quantity를 정수로 변환
                    parseInt(current.current_stock + quantityDiff, 10),  // new_quantity를 정수로 변환
                    parseInt(id, 10),                      // reference_id를 정수로 변환
                    'inbound',
                    '입고 수량 수정'
                ]);
            }

            updatedRecord = {
                ...updateResult.rows[0],
                item_name: current.item_name,
                manufacturer: current.manufacturer,
                item_subname: current.item_subname,
                item_subno: current.item_subno,
                previous_quantity: current.current_stock,
                new_quantity: current.current_stock + quantityDiff
            };
        });

        res.json({
            success: true,
            message: '입고 정보가 수정되었습니다.',
            data: updatedRecord
        });
    } catch (error) {
        console.error('Error updating inbound:', error);
        res.status(500).json({
            error: '입고 수정 중 오류가 발생했습니다.',
            details: error.message
        });
    }
});

module.exports = router;