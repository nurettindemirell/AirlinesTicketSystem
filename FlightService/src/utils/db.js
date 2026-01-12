const { poolPromise, sql } = require('../config/db');

/**
 * Execute a SQL query
 * @param {string} queryText - SQL query
 * @param {object} params - Parameters for the query (key-value pairs)
 * @returns {Promise<{data: any[], error: any, count: number}>}
 */
const query = async (queryText, params = {}) => {
    try {
        const pool = await poolPromise;
        const request = pool.request();

        // Add parameters to request
        Object.keys(params).forEach(key => {
            request.input(key, params[key]);
        });

        const result = await request.query(queryText);

        return {
            data: result.recordset || [],
            count: result.recordset ? result.recordset.length : 0,
            error: null
        };
    } catch (error) {
        console.error('SQL Error:', error.message);
        return { data: null, error, count: 0 };
    }
};

/**
 * Execute a SQL query and return a single record
 */
const querySingle = async (queryText, params = {}) => {
    const { data, error } = await query(queryText, params);
    if (error) return { data: null, error };
    return { data: data && data.length > 0 ? data[0] : null, error: null };
};

module.exports = {
    query,
    querySingle,
    sql
};
