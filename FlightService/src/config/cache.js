const Redis = require('ioredis');

// Redis connection configuration
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const DEFAULT_TTL = 300; // 5 minutes in seconds

let redis = null;
let isConnected = false;
let connectionAttempts = 0;
const MAX_CONNECTION_ATTEMPTS = 5;

// Initialize Redis connection
const initRedis = () => {
    if (redis) return redis;

    try {
        redis = new Redis(REDIS_URL, {
            maxRetriesPerRequest: 3,
            retryDelayOnFailover: 100,
            connectTimeout: 5000,
            commandTimeout: 3000,
            lazyConnect: true,
            enableOfflineQueue: false,
            reconnectOnError: (err) => {
                console.log('Redis reconnect on error:', err.message);
                return connectionAttempts < MAX_CONNECTION_ATTEMPTS;
            }
        });

        redis.on('connect', () => {
            isConnected = true;
            connectionAttempts = 0;
            console.log('✅ Connected to Redis cache');
        });

        redis.on('error', (err) => {
            connectionAttempts++;
            if (connectionAttempts <= MAX_CONNECTION_ATTEMPTS) {
                console.log(`⚠️  Redis error (attempt ${connectionAttempts}/${MAX_CONNECTION_ATTEMPTS}):`, err.message);
            }
            isConnected = false;
        });

        redis.on('close', () => {
            isConnected = false;
            console.log('Redis connection closed');
        });

        // Try to connect
        redis.connect().catch((err) => {
            console.log('⚠️  Redis initial connection failed:', err.message);
            console.log('   Cache will operate in fallback mode (no caching)');
        });

        return redis;
    } catch (error) {
        console.error('Failed to initialize Redis:', error.message);
        return null;
    }
};

// Initialize on module load
initRedis();

// Cache keys
const CACHE_KEYS = {
    AIRPORTS: 'cache:airports',
    FLIGHT_SEARCH: (params) => `cache:search:${JSON.stringify(params)}`,
    FLIGHT_DETAIL: (id) => `cache:flight:${id}`
};

/**
 * Get from cache
 * @param {string} key - Cache key
 * @returns {Promise<any>} - Cached value or null
 */
const get = async (key) => {
    if (!isConnected || !redis) {
        return null;
    }

    try {
        const data = await redis.get(key);
        if (data) {
            return JSON.parse(data);
        }
        return null;
    } catch (error) {
        console.error('Redis GET error:', error.message);
        return null;
    }
};

/**
 * Set in cache
 * @param {string} key - Cache key
 * @param {any} value - Value to cache
 * @param {number} ttl - Time to live in seconds (default 300)
 * @returns {Promise<boolean>} - Success status
 */
const set = async (key, value, ttl = DEFAULT_TTL) => {
    if (!isConnected || !redis) {
        return false;
    }

    try {
        const serialized = JSON.stringify(value);
        await redis.setex(key, ttl, serialized);
        return true;
    } catch (error) {
        console.error('Redis SET error:', error.message);
        return false;
    }
};

/**
 * Delete from cache
 * @param {string} key - Cache key
 * @returns {Promise<boolean>} - Success status
 */
const del = async (key) => {
    if (!isConnected || !redis) {
        return false;
    }

    try {
        await redis.del(key);
        return true;
    } catch (error) {
        console.error('Redis DEL error:', error.message);
        return false;
    }
};

/**
 * Delete keys by pattern
 * @param {string} pattern - Key pattern (e.g., 'cache:search:*')
 * @returns {Promise<number>} - Number of deleted keys
 */
const delByPattern = async (pattern) => {
    if (!isConnected || !redis) {
        return 0;
    }

    try {
        const keys = await redis.keys(pattern);
        if (keys.length > 0) {
            await redis.del(...keys);
        }
        return keys.length;
    } catch (error) {
        console.error('Redis DEL pattern error:', error.message);
        return 0;
    }
};

/**
 * Flush all cache
 * @returns {Promise<boolean>} - Success status
 */
const flush = async () => {
    if (!isConnected || !redis) {
        return false;
    }

    try {
        // Only flush cache keys, not all Redis data
        const deleted = await delByPattern('cache:*');
        console.log(`🗑️  Flushed ${deleted} cache keys`);
        return true;
    } catch (error) {
        console.error('Redis FLUSH error:', error.message);
        return false;
    }
};

/**
 * Get cache stats
 * @returns {Promise<object>} - Cache statistics
 */
const getStats = async () => {
    if (!isConnected || !redis) {
        return { connected: false, keys: 0 };
    }

    try {
        const keys = await redis.keys('cache:*');
        const info = await redis.info('stats');
        
        return {
            connected: true,
            keys: keys.length,
            info: info
        };
    } catch (error) {
        return { connected: false, error: error.message };
    }
};

/**
 * Check if Redis is connected
 * @returns {boolean}
 */
const isReady = () => isConnected;

/**
 * Cache middleware for Express routes
 * @param {Function|string} keyGenerator - Function to generate cache key or static key
 * @param {number} ttl - Time to live in seconds
 */
const cacheMiddleware = (keyGenerator, ttl = DEFAULT_TTL) => {
    return async (req, res, next) => {
        if (!isConnected) {
            return next();
        }

        const key = typeof keyGenerator === 'function'
            ? keyGenerator(req)
            : keyGenerator;

        try {
            const cachedData = await get(key);

            if (cachedData) {
                console.log(`📦 Redis Cache HIT: ${key}`);
                return res.json({ ...cachedData, cached: true, cacheType: 'redis' });
            }

            console.log(`📭 Redis Cache MISS: ${key}`);

            // Override res.json to cache the response
            const originalJson = res.json.bind(res);
            res.json = async (data) => {
                if (res.statusCode === 200) {
                    await set(key, data, ttl);
                }
                return originalJson({ ...data, cached: false });
            };

            next();
        } catch (error) {
            console.error('Cache middleware error:', error.message);
            next();
        }
    };
};

module.exports = {
    get,
    set,
    del,
    delByPattern,
    flush,
    getStats,
    isReady,
    cacheMiddleware,
    CACHE_KEYS
};
