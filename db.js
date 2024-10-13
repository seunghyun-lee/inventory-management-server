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
        await callback(client);
        await client.query('COMMIT');
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
        CREATE TABLE IF NOT EXISTS items (
            id SERIAL PRIMARY KEY,
            manufacturer TEXT NOT NULL,
            item_name TEXT NOT NULL,
            item_subname TEXT,
            UNIQUE(manufacturer, item_name, item_subname)
        );
  
        CREATE TABLE IF NOT EXISTS inbound (
            id SERIAL PRIMARY KEY,
            item_id INTEGER NOT NULL,
            date TEXT NOT NULL,
            supplier TEXT NOT NULL,
            total_quantity INTEGER NOT NULL,
            handler_name TEXT NOT NULL,
            warehouse_name TEXT NOT NULL,
            warehouse_shelf TEXT,
            description TEXT,
            FOREIGN KEY (item_id) REFERENCES items(id)
        );
  
        CREATE TABLE IF NOT EXISTS outbound (
            id SERIAL PRIMARY KEY,
            item_id INTEGER NOT NULL,
            date TEXT NOT NULL,
            client TEXT NOT NULL,
            total_quantity INTEGER NOT NULL,
            handler_name TEXT NOT NULL,
            warehouse_name TEXT NOT NULL,
            warehouse_shelf TEXT,
            description TEXT,
            FOREIGN KEY (item_id) REFERENCES items(id)
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
  
        CREATE OR REPLACE VIEW current_inventory AS
        SELECT 
            i.id AS item_id,
            i.manufacturer,
            i.item_name,
            i.item_subname,
            COALESCE(inb.warehouse_name, outb.warehouse_name) AS warehouse_name,
            COALESCE(inb.warehouse_shelf, outb.warehouse_shelf) AS warehouse_shelf,
            COALESCE(inb.description, outb.description) AS description,
            COALESCE(SUM(inb.total_quantity), 0) - COALESCE(SUM(outb.total_quantity), 0) AS current_quantity
        FROM 
            items i
        LEFT JOIN 
            inbound inb ON i.id = inb.item_id
        LEFT JOIN 
            outbound outb ON i.id = outb.item_id
        GROUP BY 
            i.id, i.manufacturer, i.item_name, i.item_subname, 
            COALESCE(inb.warehouse_name, outb.warehouse_name),
            COALESCE(inb.warehouse_shelf, outb.warehouse_shelf),
            COALESCE(inb.description, outb.description);
        `);
        console.log('Tables created successfully');
    } catch (err) {
        console.error('Error creating tables:', err);
    } finally {
        client.release();
    }
}

// 애플리케이션 시작 시 테이블 생성
createTables();

module.exports = {
    query,
    run,
    get,
    all,
    runTransaction
}