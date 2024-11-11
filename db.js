if (process.env.NODE_ENV !== 'production') {
    require('dotenv').config({ path: '.env.development.local' });
}
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.POSTGRES_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

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
    const client = await pool.connect();
    try {
        const result = await client.query(sql, params);
        return { id: result.rows[0] && result.rows[0].id };
    } finally {
        client.release();
    }
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

async function createTables() {
    const client = await pool.connect();
    try {
        await client.query(`
            DROP TABLE IF EXISTS current_inventory CASCADE;
            DROP TRIGGER IF EXISTS after_inbound_insert ON inbound;
            DROP TRIGGER IF EXISTS after_inbound_update ON inbound;
            DROP TRIGGER IF EXISTS after_outbound_insert ON outbound;
            DROP TRIGGER IF EXISTS after_outbound_update ON outbound;
            DROP TRIGGER IF EXISTS after_inbound_cancel ON inbound;
            DROP TRIGGER IF EXISTS outbound_audit_trigger ON outbound;
            DROP TRIGGER IF EXISTS update_inbound_updated_at ON inbound;
            DROP TRIGGER IF EXISTS update_outbound_updated_at ON outbound;
            DROP FUNCTION IF EXISTS update_inventory_audit CASCADE;
            DROP FUNCTION IF EXISTS update_inventory CASCADE;
            DROP FUNCTION IF EXISTS handle_inbound_cancel CASCADE;
            DROP FUNCTION IF EXISTS update_updated_at_column CASCADE;

            -- Create base tables
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

            CREATE TABLE IF NOT EXISTS events (
                id SERIAL PRIMARY KEY,
                title VARCHAR(255) NOT NULL,
                description TEXT,
                start_time TIMESTAMP WITH TIME ZONE NOT NULL,
                end_time TIMESTAMP WITH TIME ZONE NOT NULL,
                all_day BOOLEAN DEFAULT false,
                author VARCHAR(100) NOT NULL,
                location VARCHAR(255),
                notification BOOLEAN DEFAULT false,
                color VARCHAR(20) DEFAULT '#1a73e8',
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS users ( 
                id SERIAL PRIMARY KEY,
                username TEXT NOT NULL UNIQUE,
                password TEXT NOT NULL,
                handler_name TEXT NOT NULL,
                role TEXT NOT NULL,
                email TEXT NOT NULL UNIQUE,
                reset_token TEXT,
                reset_token_expires BIGINT 
            );
    
            CREATE TABLE IF NOT EXISTS manufacturer (
                id SERIAL PRIMARY KEY,
                manufacturer TEXT NOT NULL UNIQUE
            );

            CREATE TABLE IF NOT EXISTS warehouse (
                id SERIAL PRIMARY KEY,
                warehouse TEXT NOT NULL UNIQUE
            );

            CREATE TABLE IF NOT EXISTS shelf (
                id SERIAL PRIMARY KEY,
                shelf TEXT NOT NULL UNIQUE
            );

            -- Create functions
            CREATE OR REPLACE FUNCTION update_updated_at_column()
            RETURNS TRIGGER AS $$
            BEGIN
                NEW.updated_at = CURRENT_TIMESTAMP;
                RETURN NEW;
            END;
            $$ LANGUAGE plpgsql;

            CREATE OR REPLACE FUNCTION update_inventory()
                RETURNS TRIGGER AS $$
                BEGIN
                    IF TG_TABLE_NAME = 'inbound' THEN
                        -- 입고 처리 (기존 코드 유지)
                        IF NEW.description NOT LIKE '%[취소됨]%' THEN
                            INSERT INTO current_inventory (
                                item_id, warehouse_name, warehouse_shelf, current_quantity, last_updated
                            ) VALUES (
                                NEW.item_id,
                                NEW.warehouse_name,
                                NEW.warehouse_shelf,
                                NEW.total_quantity,
                                CURRENT_TIMESTAMP
                            )
                            ON CONFLICT (item_id, warehouse_name, warehouse_shelf)
                            DO UPDATE SET
                                current_quantity = (
                                    CASE 
                                        WHEN TG_OP = 'UPDATE' THEN 
                                            current_inventory.current_quantity - OLD.total_quantity + NEW.total_quantity
                                        ELSE 
                                            current_inventory.current_quantity + NEW.total_quantity
                                    END
                                ),
                                last_updated = CURRENT_TIMESTAMP;
                        END IF;
                    ELSIF TG_TABLE_NAME = 'outbound' THEN
                        IF TG_OP = 'INSERT' THEN
                            -- 출고 처리 (신규 출고)
                            UPDATE current_inventory
                            SET 
                                current_quantity = current_quantity - NEW.total_quantity,
                                last_updated = CURRENT_TIMESTAMP
                            WHERE 
                                item_id = NEW.item_id 
                                AND warehouse_name = NEW.warehouse_name 
                                AND warehouse_shelf = NEW.warehouse_shelf;
                        ELSIF TG_OP = 'UPDATE' THEN
                            -- 출고 수정 처리
                            UPDATE current_inventory
                            SET 
                                current_quantity = current_quantity + OLD.total_quantity - NEW.total_quantity,
                                last_updated = CURRENT_TIMESTAMP
                            WHERE 
                                item_id = NEW.item_id 
                                AND warehouse_name = NEW.warehouse_name 
                                AND warehouse_shelf = NEW.warehouse_shelf;
                        END IF;
                    END IF;
                    
                    -- Audit 기록
                    INSERT INTO inventory_audit (
                        item_id,
                        operation_type,
                        quantity_change,
                        previous_quantity,
                        new_quantity,
                        reference_id,
                        reference_type,
                        description
                    )
                    SELECT
                        NEW.item_id,
                        CASE 
                            WHEN TG_OP = 'UPDATE' THEN TG_TABLE_NAME || '_update'
                            ELSE TG_TABLE_NAME
                        END,
                        CASE 
                            WHEN TG_TABLE_NAME = 'inbound' AND TG_OP = 'UPDATE' THEN NEW.total_quantity - OLD.total_quantity
                            WHEN TG_TABLE_NAME = 'outbound' AND TG_OP = 'UPDATE' THEN OLD.total_quantity - NEW.total_quantity
                            WHEN TG_TABLE_NAME = 'inbound' THEN NEW.total_quantity
                            ELSE -NEW.total_quantity
                        END,
                        (
                            SELECT current_quantity 
                            FROM current_inventory 
                            WHERE item_id = NEW.item_id 
                                AND warehouse_name = NEW.warehouse_name 
                                AND warehouse_shelf = NEW.warehouse_shelf
                        ),
                        (
                            SELECT current_quantity 
                            FROM current_inventory 
                            WHERE item_id = NEW.item_id 
                                AND warehouse_name = NEW.warehouse_name 
                                AND warehouse_shelf = NEW.warehouse_shelf
                        ) + CASE 
                            WHEN TG_TABLE_NAME = 'inbound' AND TG_OP = 'UPDATE' THEN NEW.total_quantity - OLD.total_quantity
                            WHEN TG_TABLE_NAME = 'outbound' AND TG_OP = 'UPDATE' THEN OLD.total_quantity - NEW.total_quantity
                            WHEN TG_TABLE_NAME = 'inbound' THEN NEW.total_quantity
                            ELSE -NEW.total_quantity
                        END,
                        NEW.id,
                        TG_TABLE_NAME,
                        NEW.description;

                    RETURN NEW;
                END;
                $$ LANGUAGE plpgsql;

            CREATE OR REPLACE FUNCTION handle_inbound_cancel()
            RETURNS TRIGGER AS $$
            BEGIN
                IF NEW.description LIKE '%[취소됨]%' AND OLD.description NOT LIKE '%[취소됨]%' THEN
                    UPDATE current_inventory
                    SET 
                        current_quantity = current_quantity - OLD.total_quantity,
                        last_updated = CURRENT_TIMESTAMP
                    WHERE 
                        item_id = OLD.item_id 
                        AND warehouse_name = OLD.warehouse_name 
                        AND warehouse_shelf = OLD.warehouse_shelf;
                        
                    -- Audit 기록
                    INSERT INTO inventory_audit (
                        item_id,
                        operation_type,
                        quantity_change,
                        previous_quantity,
                        new_quantity,
                        reference_id,
                        reference_type,
                        description
                    )
                    SELECT
                        OLD.item_id,
                        'inbound_cancel',
                        -OLD.total_quantity,
                        current_quantity + OLD.total_quantity,
                        current_quantity,
                        OLD.id,
                        'inbound',
                        NEW.description
                    FROM current_inventory
                    WHERE 
                        item_id = OLD.item_id 
                        AND warehouse_name = OLD.warehouse_name 
                        AND warehouse_shelf = OLD.warehouse_shelf;
                END IF;
                RETURN NEW;
            END;
            $$ LANGUAGE plpgsql;

            -- 재고 데이터 재계산 함수 추가
            CREATE OR REPLACE FUNCTION recalculate_inventory()
            RETURNS void AS $$
            BEGIN
                -- 재고 테이블 초기화
                TRUNCATE TABLE current_inventory;
                
                -- 입고 데이터 반영
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
                    i.warehouse_shelf;
                
                -- 출고 데이터 반영
                UPDATE current_inventory ci
                SET current_quantity = ci.current_quantity - COALESCE(
                    (SELECT SUM(o.total_quantity)
                    FROM outbound o
                    WHERE o.item_id = ci.item_id
                    AND o.warehouse_name = ci.warehouse_name
                    AND o.warehouse_shelf = ci.warehouse_shelf),
                    0
                );
            END;
            $$ LANGUAGE plpgsql;

            -- Create triggers
            CREATE TRIGGER update_inbound_updated_at
                BEFORE UPDATE ON inbound
                FOR EACH ROW
                EXECUTE FUNCTION update_updated_at_column();

            CREATE TRIGGER update_outbound_updated_at
                BEFORE UPDATE ON outbound
                FOR EACH ROW
                EXECUTE FUNCTION update_updated_at_column();

            CREATE TRIGGER after_inbound_insert
                AFTER INSERT ON inbound
                FOR EACH ROW
                EXECUTE FUNCTION update_inventory();

            CREATE TRIGGER after_inbound_update
                AFTER UPDATE ON inbound
                FOR EACH ROW
                EXECUTE FUNCTION update_inventory();

            CREATE TRIGGER after_outbound_insert
                AFTER INSERT ON outbound
                FOR EACH ROW
                EXECUTE FUNCTION update_inventory();

            CREATE TRIGGER after_outbound_update
                AFTER UPDATE ON outbound
                FOR EACH ROW
                EXECUTE FUNCTION update_inventory();

            CREATE TRIGGER after_inbound_cancel
                AFTER UPDATE ON inbound
                FOR EACH ROW
                EXECUTE FUNCTION handle_inbound_cancel();
        `);
        
        console.log('Tables, views, and triggers created successfully');
    } catch (err) {
        console.error('Error creating database objects:', err);
        throw err;
    } finally {
        client.release();
    }
}

// 애플리케이션 시작 시 테이블 생성
createTables().catch(err => {
    console.error('Failed to initialize database:', err);
    process.exit(1);
});

module.exports = {
    query,
    run,
    get,
    all,
    runTransaction
}
