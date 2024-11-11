require('dotenv').config();

const express = require('express');
const cors = require('cors');
const inventoryRoute = require('./routes/inventoryRoutes');
const transactionRoute = require('./routes/transactionRoutes');
const inventoryHistory = require('./routes/inventoryHistoryRoutes');
const inboundHistory = require('./routes/inboundhistoryRoutes');
const outboundHistory = require('./routes/outboundhistoryRoutes');
const calendarRoutes = require('./routes/calendarRoutes');
const userRoutes = require('./routes/userRoutes');
const manufacturerRoutes = require('./routes/manufacturerRoutes');
const warehouseRoutes = require('./routes/warehouseRoutes');
const shelfRoutes = require('./routes/shelfRoutes');
const itemRoutes = require('./routes/itemRoutes');
const excelRoutes = require('./routes/excelRoutes');
const passwordResetRoutes = require('./routes/passwordResetRoutes');
const statusRoutes = require('./routes/statusRoutes');

const app = express();

app.use(cors({
    origin: ['https://inventory-management-client-iota.vercel.app', 'http://localhost:3000'],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true
}));
app.use(express.json());

app.use('/api/inventory', inventoryRoute);
app.use('/api/transactions', transactionRoute);
app.use('/api/inventory-history', inventoryHistory);
app.use('/api/inbound-history', inboundHistory);
app.use('/api/outbound-history', outboundHistory);
app.use('/api/events', calendarRoutes);
app.use('/api/users', userRoutes);
app.use('/api/manufacturers', manufacturerRoutes);
app.use('/api/warehouses', warehouseRoutes);
app.use('/api/shelfs', shelfRoutes);
app.use('/api/items', itemRoutes);
app.use('/api', excelRoutes);
app.use('/api/users', passwordResetRoutes);
app.use('/api', statusRoutes);

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
