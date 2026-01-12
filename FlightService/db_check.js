require('dotenv').config();
const sql = require('mssql');

const config = {
    user: process.env.AZURE_SQL_USER,
    password: process.env.AZURE_SQL_PASSWORD,
    server: process.env.AZURE_SQL_SERVER,
    database: process.env.AZURE_SQL_DATABASE,
    options: {
        encrypt: true,
        trustServerCertificate: false,
        connectTimeout: 30000 // 30 seconds
    }
};

async function checkConnection() {
    console.log('Testing connection to:', config.server);
    try {
        const pool = await sql.connect(config);
        console.log('✅ Connected successfully!');
        const result = await pool.request().query('SELECT 1 as val');
        console.log('Query result:', result.recordset[0]);
        await pool.close();
    } catch (err) {
        console.error('❌ Connection failed:', err);
        console.error('Details:', err.originalError || err);
    }
}

checkConnection();
