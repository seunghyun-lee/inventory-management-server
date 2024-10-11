const db = require('../db');

class Transaction {
    static async createInbound(inboundData) {
        return new Promise((resolve, reject) => {
            const { item_id, date, supplier, total_quantity, handler_name, warehouse_name, warehouse_shelf, description } = inboundData;
            db.run('INSERT INTO inbound (item_id, date, supplier, total_quantity, handler_name, warehouse_name, warehouse_shelf, description) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
                [item_id, date, supplier, total_quantity, handler_name, warehouse_name, warehouse_shelf, description],
                function(err) {
                    if (err) reject(err);
                    else resolve(this.lastID);
                }
            );
        });
    }

    static async createOutbound(outboundData) {
        return new Promise((resolve, reject) => {
            const { item_id, date, client, total_quantity, handler_name, warehouse_name, warehouse_shelf, description } = inboundData;
            db.run('INSERT INTO outbound (item_id, date, client, total_quantity, handler_name, warehouse_name, warehouse_shelf, description) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
                [item_id, date, client, total_quantity, handler_name, warehouse_name, warehouse_shelf, description],
                function(err) {
                    if (err) reject(err);
                    else resolve(this.lastID);
                }
            );
        });
    }
}

module.exports = Transaction;