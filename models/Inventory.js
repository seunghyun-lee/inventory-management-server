const db = require('../db');

class Inventory {
    static async getAll() {
        return new Promise((resolve, reject) => {
            db.all('SELECT * FROM current_inventory', (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
    }

    static async getById() {
        return new Promise((resolve, reject) => {
            db.get('SELECT * FROM current_inventory WHERE item_id = ?', [id], (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
    }

    static async create(item) {
        return new Promise((resolve, reject) => {
            const { manufacturer, item_name, quantity, boxes, total_quantiry } = item;
            db.run('INSERT INTO current_inventory (manufacturer, item_name, quantity, boxes, total_quantiry) VALUES (?,?,?,?,?)',
                [manufacturer, item_name, quantity, boxes, total_quantiry ],
                function(err) {
                    if (err) reject(err);
                    else resolve(this.lastID);
                }
            );
        });
    }

    // Add update and delete methods below
}

module.exports = Inventory;