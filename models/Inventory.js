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
            db.get('SELECT * FROM current_inventory WHERE item_id = $1', [id], (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
    }

    static async create(item) {
        return new Promise((resolve, reject) => {
            const { manufacturer, item_name, item_subname, warehouse_name, warehouse_shelf, description, current_quantiry } = item;
            db.run('INSERT INTO current_inventory (manufacturer, item_name, item_subname, warehouse_name, warehouse_shelf, description, current_quantiry) VALUES ($1, $2, $3, $4, $5, $6, $7)',
                [manufacturer, item_name, item_subname, warehouse_name, warehouse_shelf, description, current_quantiry],
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