const sql = require('mssql');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '.env') });

const config = {
    user: process.env.AZURE_SQL_USER,
    password: process.env.AZURE_SQL_PASSWORD,
    server: process.env.AZURE_SQL_SERVER,
    database: process.env.AZURE_SQL_DATABASE,
    options: {
        encrypt: true,
        trustServerCertificate: false,
        connectTimeout: 30000
    }
};

async function resetDb() {
    try {
        console.log('🔌 Connecting to Azure SQL...');
        const pool = await sql.connect(config);
        console.log('✅ Connected.');

        // 1. Drop All Foreign Key Constraints First (Aggressive Cleanup)
        console.log('🔥 Dropping all foreign key constraints...');
        const dropFksQuery = `
            DECLARE @sql NVARCHAR(MAX) = N'';
            SELECT @sql += N'ALTER TABLE ' + QUOTENAME(OBJECT_SCHEMA_NAME(parent_object_id))
                + '.' + QUOTENAME(OBJECT_NAME(parent_object_id)) + 
                ' DROP CONSTRAINT ' + QUOTENAME(name) + ';'
            FROM sys.foreign_keys;
            EXEC sp_executesql @sql;
        `;
        await pool.request().query(dropFksQuery);
        console.log('✅ Foreign keys dropped.');

        // 2. Drop All Tables
        console.log('🗑️ Dropping all tables...');
        const dropTablesQuery = `
            DECLARE @sql2 NVARCHAR(MAX) = N'';
            SELECT @sql2 += N'DROP TABLE IF EXISTS ' + QUOTENAME(TABLE_SCHEMA) + '.' + QUOTENAME(TABLE_NAME) + ';'
            FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE = 'BASE TABLE';
            EXEC sp_executesql @sql2;
        `;
        await pool.request().query(dropTablesQuery);
        console.log('✅ All tables dropped.');

        // 3. Read Schema File
        const schemaPath = path.join(__dirname, '../infra/azure_schema.sql');
        console.log(`📖 Reading schema from: ${schemaPath}`);
        const schemaSql = fs.readFileSync(schemaPath, 'utf8');

        // 4. Execute Schema (Split by GO)
        console.log('🏗️ Creating schema from azure_schema.sql...');
        const batches = schemaSql.split(/^\s*GO\s*$/m); // Regex for GO on own line

        for (let i = 0; i < batches.length; i++) {
            const batch = batches[i];
            const cleanBatch = batch.trim();
            if (cleanBatch.length > 0) {
                try {
                    await pool.request().query(cleanBatch);
                } catch (e) {
                    console.error(`❌ Error executing batch ${i + 1}:`);
                    console.error(cleanBatch.substring(0, 100) + '...');
                    throw e;
                }
            }
        }
        console.log('✅ Schema created successfully.');

    } catch (err) {
        console.error('❌ Reset failed:', err);
    } finally {
        sql.close();
    }
}

resetDb();
