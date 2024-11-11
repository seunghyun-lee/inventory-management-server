if (process.env.NODE_ENV !== 'production') {
    require('dotenv').config({ path: '.env.development.local' });
}
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.POSTGRES_URL,
    ssl: process.env.NODE_ENV === 'production' ? { 
        rejectUnauthorized: false 
    } : false
});

// 재고 업데이트 함수
async function updateInventory(client, {
    item_id,
    warehouse_name,
    warehouse_shelf,
    quantity_change,
    operation_type,
    reference_id,
    description = ''
}) {
    // 현재 재고 조회
    const currentInventory = await client.query(
        `SELECT current_quantity 
         FROM current_inventory 
         WHERE item_id = $1 
         AND warehouse_name = $2 
         AND warehouse_shelf = $3`,
        [item_id, warehouse_name, warehouse_shelf]
    );

    const currentQuantity = currentInventory.rows[0]?.current_quantity || 0;
    const newQuantity = currentQuantity + quantity_change;

    if (newQuantity < 0) {
        throw new Error('재고가 부족합니다');
    }

    // 재고 업데이트
    await client.query(
        `INSERT INTO current_inventory (
            item_id, warehouse_name, warehouse_shelf, current_quantity, last_updated
        ) VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
        ON CONFLICT (item_id, warehouse_name, warehouse_shelf)
        DO UPDATE SET 
            current_quantity = $4,
            last_updated = CURRENT_TIMESTAMP`,
        [item_id, warehouse_name, warehouse_shelf, newQuantity]
    );

    // 감사 로그 추가
    await client.query(
        `INSERT INTO inventory_audit (
            item_id,
            operation_type,
            quantity_change,
            previous_quantity,
            new_quantity,
            reference_id,
            reference_type,
            description
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
            item_id,
            operation_type,
            quantity_change,
            currentQuantity,
            newQuantity,
            reference_id,
            operation_type.split('_')[0], // inbound or outbound
            description
        ]
    );

    return { currentQuantity, newQuantity };
}

// 기본 테이블 생성
async function createTables() {
    const client = await pool.connect();
    try {
        await client.query(`
            CREATE TABLE IF NOT EXISTS items (
                id SERIAL PRIMARY KEY,
                manufacturer TEXT NOT NULL,
                item_name TEXT NOT NULL,
                item_subname TEXT,
                item_subno TEXT,
                price INTEGER DEFAULT 0,
                UNIQUE(manufacturer, item_name, item_subname, item_subno)
            );
    
            CREATE TABLE IF NOT EXISTS inbound (
                id SERIAL PRIMARY KEY,
                item_id INTEGER NOT NULL,
                date TIMESTAMP NOT NULL,
                supplier TEXT NOT NULL,
                total_quantity INTEGER NOT NULL,
                handler_name TEXT NOT NULL,
                warehouse_name TEXT NOT NULL,
                warehouse_shelf TEXT,
                description TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (item_id) REFERENCES items(id)
            );
    
            CREATE TABLE IF NOT EXISTS outbound (
                id SERIAL PRIMARY KEY,
                item_id INTEGER NOT NULL,
                date TIMESTAMP NOT NULL,
                client TEXT NOT NULL,
                total_quantity INTEGER NOT NULL,
                handler_name TEXT NOT NULL,
                warehouse_name TEXT NOT NULL,
                warehouse_shelf TEXT,
                description TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (item_id) REFERENCES items(id)
            );

            CREATE TABLE IF NOT EXISTS current_inventory (
                id SERIAL PRIMARY KEY,
                item_id INTEGER NOT NULL REFERENCES items(id),
                warehouse_name TEXT NOT NULL,
                warehouse_shelf TEXT,
                current_quantity INTEGER NOT NULL DEFAULT 0,
                last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(item_id, warehouse_name, warehouse_shelf)
            );

            CREATE TABLE IF NOT EXISTS inventory_audit (
                id SERIAL PRIMARY KEY,
                item_id INTEGER NOT NULL,
                operation_type TEXT NOT NULL,
                quantity_change INTEGER NOT NULL,
                previous_quantity INTEGER NOT NULL,
                new_quantity INTEGER NOT NULL,
                reference_id INTEGER NOT NULL,
                reference_type TEXT NOT NULL,
                description TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (item_id) REFERENCES items(id)
            );
        `);
        
        console.log('Tables created successfully');
    } catch (err) {
        console.error('Error creating tables:', err);
        throw err;
    } finally {
        client.release();
    }
}

// 기본 쿼리 함수들
async function query(text, params) {
    const client = await pool.connect();
    try {
        const result = await client.query(text, params);
        return result.rows;
    } finally {
        client.release();
    }
}

async function run(sql, params = []) {
    const result = await query(sql, params);
    return { id: result[0] && result[0].id };
}

async function get(sql, params = []) {
    const result = await query(sql, params);
    return result[0];
}

async function all(sql, params = []) {
    return await query(sql, params);
}

async function runTransaction(callback) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await callback(client);
        await client.query('COMMIT');
        return result;
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

// 입고 처리
async function processInbound({ 
    item_id, 
    quantity, 
    supplier,
    warehouse_name, 
    warehouse_shelf, 
    handler_name,
    description 
}) {
    return await runTransaction(async (client) => {
        // 입고 기록 생성
        const inboundResult = await client.query(
            `INSERT INTO inbound (
                item_id,
                date,
                supplier,
                total_quantity,
                warehouse_name,
                warehouse_shelf,
                description,
                handler_name
            ) VALUES ($1, CURRENT_TIMESTAMP, $2, $3, $4, $5, $6, $7)
            RETURNING *`,
            [item_id, supplier, quantity, warehouse_name, warehouse_shelf, description, handler_name]
        );

        // 재고 업데이트
        const inventoryResult = await updateInventory(client, {
            item_id,
            warehouse_name,
            warehouse_shelf,
            quantity_change: quantity,
            operation_type: 'inbound',
            reference_id: inboundResult.rows[0].id,
            description
        });

        return {
            ...inboundResult.rows[0],
            previous_quantity: inventoryResult.currentQuantity,
            new_quantity: inventoryResult.newQuantity
        };
    });
}

// 출고 처리
async function processOutbound({
    item_id,
    quantity,
    client_name,
    warehouse_name,
    warehouse_shelf,
    handler_name,
    description
}) {
    return await runTransaction(async (client) => {
        // 출고 기록 생성
        const outboundResult = await client.query(
            `INSERT INTO outbound (
                item_id,
                date,
                client,
                total_quantity,
                warehouse_name,
                warehouse_shelf,
                description,
                handler_name
            ) VALUES ($1, CURRENT_TIMESTAMP, $2, $3, $4, $5, $6, $7)
            RETURNING *`,
            [item_id, client_name, quantity, warehouse_name, warehouse_shelf, description, handler_name]
        );

        // 재고 업데이트
        const inventoryResult = await updateInventory(client, {
            item_id,
            warehouse_name,
            warehouse_shelf,
            quantity_change: -quantity,
            operation_type: 'outbound',
            reference_id: outboundResult.rows[0].id,
            description
        });

        return {
            ...outboundResult.rows[0],
            previous_quantity: inventoryResult.currentQuantity,
            new_quantity: inventoryResult.newQuantity
        };
    });
}

// 출고 수정
async function updateOutbound(outbound_id, { quantity, description }) {
    return await runTransaction(async (client) => {
        // 기존 출고 정보 조회
        const currentOutbound = await client.query(
            `SELECT * FROM outbound WHERE id = $1`,
            [outbound_id]
        );

        if (!currentOutbound.rows[0]) {
            throw new Error('출고 기록을 찾을 수 없습니다');
        }

        const oldRecord = currentOutbound.rows[0];
        const quantityDiff = oldRecord.total_quantity - quantity;

        // 재고 업데이트
        const inventoryResult = await updateInventory(client, {
            item_id: oldRecord.item_id,
            warehouse_name: oldRecord.warehouse_name,
            warehouse_shelf: oldRecord.warehouse_shelf,
            quantity_change: quantityDiff,
            operation_type: 'outbound_update',
            reference_id: outbound_id,
            description
        });

        // 출고 기록 업데이트
        const updateResult = await client.query(
            `UPDATE outbound 
             SET total_quantity = $1, 
                 description = $2,
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = $3
             RETURNING *`,
            [quantity, description, outbound_id]
        );

        return {
            ...updateResult.rows[0],
            previous_quantity: inventoryResult.currentQuantity,
            new_quantity: inventoryResult.newQuantity
        };
    });
}

// 재고 재계산
async function recalculateInventory() {
    return await runTransaction(async (client) => {
        // 재고 테이블 초기화
        await client.query('TRUNCATE TABLE current_inventory');
        
        // 입고 데이터 반영
        await client.query(`
            INSERT INTO current_inventory (
                item_id, 
                warehouse_name, 
                warehouse_shelf, 
                current_quantity,
                last_updated
            )
            SELECT 
                i.item_id,
                i.warehouse_name,
                i.warehouse_shelf,
                SUM(CASE WHEN i.description NOT LIKE '%[취소됨]%' THEN i.total_quantity ELSE 0 END),
                MAX(i.updated_at)
            FROM inbound i
            GROUP BY 
                i.item_id,
                i.warehouse_name,
                i.warehouse_shelf
        `);
        
        // 출고 데이터 반영
        const locations = await client.query(`
            SELECT DISTINCT item_id, warehouse_name, warehouse_shelf 
            FROM current_inventory
        `);

        for (const loc of locations.rows) {
            const outbound = await client.query(`
                SELECT COALESCE(SUM(total_quantity), 0) as total_outbound
                FROM outbound
                WHERE item_id = $1 
                AND warehouse_name = $2
                AND warehouse_shelf = $3
            `, [loc.item_id, loc.warehouse_name, loc.warehouse_shelf]);

            await client.query(`
                UPDATE current_inventory
                SET current_quantity = current_quantity - $1
                WHERE item_id = $2 
                AND warehouse_name = $3
                AND warehouse_shelf = $4
            `, [outbound.rows[0].total_outbound, loc.item_id, loc.warehouse_name, loc.warehouse_shelf]);
        }
    });
}

// 애플리케이션 시작 시 테이블 생성
createTables().catch(err => {
    console.error('Failed to create tables:', err);
    process.exit(1);
});

module.exports = {
    query,
    run,
    get,
    all,
    runTransaction,
    processInbound,
    processOutbound,
    updateOutbound,
    recalculateInventory
};