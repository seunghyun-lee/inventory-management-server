const db = require('../db');

class Transaction {
    static async createInbound(inboundData) {
        return new Promise((resolve, reject) => {
            const { item_id, date, supplier, quantity, boxes, total_quantity, handler_name, warehouse_name, description } = inboundData;
            db.run('INSERT INTO inbound (item_id, date, supplier, quantity, boxes, total_quantity, handler_name, warehouse_name, description) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
                [item_id, date, supplier, quantity, boxes, total_quantity, handler_name, warehouse_name, description],
                function(err) {
                    if (err) reject(err);
                    else resolve(this.lastID);
                }
            );
        });
    }

    static async createOutbound(outboundData) {
        return new Promise((resolve, reject) => {
            const { item_id, date, supplier, quantity, boxes, total_quantity, handler_name, warehouse_name, description } = inboundData;
            db.run('INSERT INTO outbound (item_id, date, supplier, quantity, boxes, total_quantity, handler_name, warehouse_name, description) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
                [item_id, date, supplier, quantity, boxes, total_quantity, handler_name, warehouse_name, description],
                function(err) {
                    if (err) reject(err);
                    else resolve(this.lastID);
                }
            );
        });
    }
}

module.exports = Transaction;