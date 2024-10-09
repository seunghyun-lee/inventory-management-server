const express = require('express');
const router = express.Router();
const db = require('../db');

router.get('/', async (req, res) => {
    try {
        const inventory = await db.all(`
            SELECT 
                i.id, 
                i.manufacturer, 
                i.item_name, 
                i.item_subname, 
                ci.current_quantity, 
                ci.warehouse_name,
                ci.description
            FROM 
                items i
            LEFT JOIN 
                current_inventory ci ON i.id = ci.item_id
            `);
        res.json(inventory);
    } catch (error) {
        console.error('Error fetching inventory:', error);
        res.status(500).json({ error: error.message });
    }
});

router.get('/:id', async (req, res) => {
    try {
        const item = await db.get(`
            SELECT 
                i.id, 
                i.manufacturer, 
                i.item_name,
                i.item_subname,
                ci.current_quantity
            FROM 
                items i
            LEFT JOIN 
                current_inventory ci ON i.id = ci.item_id
            WHERE
                i.id = ?
            `, [req.params.id]);

        if (!item) {
            return res.status(404).json({ message: 'Item not found' });
        }

        res.json(item);
    } catch (error) {
        console.error('Error fetching item details:', error);
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

module.exports = router;