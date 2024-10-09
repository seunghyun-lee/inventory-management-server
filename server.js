require('dotenv').config();

const express = require('express');
const cors = require('cors');
const inventoryRoute = require('./routes/inventoryRoutes');
const transactionRoute = require('./routes/transactionRoutes');
const inboundHistory = require('./routes/inboundhistoryRoutes');
const outboundHistory = require('./routes/outboundhistoryRoutes');
const userRoutes = require('./routes/userRoutes');

const app = express();

app.use(cors({
    origin: ['https://inventory-management-client-iota.vercel.app', 'http://localhost:3000'],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());

app.use('/api/inventory', inventoryRoute);
app.use('/api/transactions', transactionRoute);
app.use('/api/inbound-history', inboundHistory);
app.use('/api/outbound-history', outboundHistory);
app.use('/api/users', userRoutes);

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
