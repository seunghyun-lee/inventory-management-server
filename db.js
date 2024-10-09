const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.resolve(__dirname, 'inventory.db');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error opening database', err);
    } else {
        console.log('Database connected');
        db.serialize(() => {
            db.run(`CREATE TABLE IF NOT EXISTS items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                manufacturer TEXT NOT NULL,
                item_name TEXT NOT NULL,
                item_subname TEXT,
                UNIQUE(manufacturer, item_name, item_subname)
            )`);
            db.run(`CREATE TABLE IF NOT EXISTS inbound (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                item_id INTEGER NOT NULL,
                date TEXT NOT NULL,
                supplier TEXT NOT NULL,
                total_quantity INTEGER NOT NULL,
                handler_name TEXT NOT NULL,
                warehouse_name TEXT NOT NULL,
                description TEXT,
                FOREIGN KEY (item_id) REFERENCES items(id)
            )`);
            db.run(`CREATE TABLE IF NOT EXISTS outbound (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                item_id INTEGER NOT NULL,
                date TEXT NOT NULL,
                client TEXT NOT NULL,
                total_quantity INTEGER NOT NULL,
                handler_name TEXT NOT NULL,
                warehouse_name TEXT NOT NULL,
                description TEXT,
                FOREIGN KEY (item_id) REFERENCES items(id)
            )`);
            db.run(`CREATE VIEW IF NOT EXISTS current_inventory AS
                SELECT 
                    i.id AS item_id,
                    i.manufacturer,
                    i.item_name,
                    i.item_subname,
                    inb.warehouse_name,
                    inb.description,
                    COALESCE(SUM(inb.total_quantity), 0) - COALESCE(SUM(outb.total_quantity), 0) AS current_quantity
                FROM 
                    items i
                LEFT JOIN 
                    inbound inb ON i.id = inb.item_id
                LEFT JOIN 
                    outbound outb ON i.id = outb.item_id
                GROUP BY 
                    i.id
            `);
            db.run(`CREATE TABLE IF NOT EXISTS users ( 
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL UNIQUE,
                password TEXT NOT NULL,
                handler_name TEXT NOT NULL,
                role TEXT NOT NULL 
            )`);
        });
    }
});

// Promise 기반의 쿼리 실행 함수
function run(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function (err) {
            if (err) {
                console.log('Error running sql ' + sql)
                console.log(err)
                reject(err)
            } else {
                resolve({ id: this.lastID })
            }
        })
    })
}

// Promise 기반의 데이터 조회 함수
function get(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err, result) => {
            if (err) {
                console.log('Error running sql: ' + sql)
                console.log(err)
                reject(err)
            } else {
                resolve(result)
            }
        })
    })
}

// Promise 기반의 다중 데이터 조회 함수
function all(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) {
                console.log('Error running sql: ' + sql)
                console.log(err)
                reject(err)
            } else {
                resolve(rows)
            }
        })
    })
}

// 트랜잭션 함수
async function runTransaction(callback) {
    return new Promise((resolve, reject) => {
        db.serialize(() => {
            db.run('BEGIN TRANSACTION');
            callback(db)
                .then(() => {
                    db.run('COMMIT', (err) => {
                        if (err) reject(err);
                        else resolve();
                    });
                })
                .catch((err) => {
                    db.run('ROLLBACK', () => {
                        reject(err);
                    });
                });
        });
    });
}

module.exports = {
    run,
    get,
    all,
    runTransaction
}