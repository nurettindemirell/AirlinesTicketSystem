const { CognitoJwtVerifier } = require("aws-jwt-verify");
const config = require('../config/cognito');

// User roles mapped to Cognito Groups
const ROLES = {
    ADMIN: 'ADMIN',
    MS_MEMBER: 'MS_MEMBER',
    SERVICE_OTHER_AIRLINE: 'SERVICE_OTHER_AIRLINE'
};

// Create the verifier
let verifier = null;
if (config.userPoolId && config.clientId) {
    verifier = CognitoJwtVerifier.create({
        userPoolId: config.userPoolId,
        tokenUse: "access",
        clientId: config.clientId,
    });
} else {
    console.warn('⚠️  AWS Cognito configuration missing. Auth middleware will fail for protected routes.');
}

/**
 * Middleware: Require authentication
 */
const requireAuth = async (req, res, next) => {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({
            error: 'Unauthorized',
            message: 'No token provided'
        });
    }

    const token = authHeader.split(' ')[1];

    try {
        if (!verifier) {
            throw new Error('Cognito not configured');
        }

        const payload = await verifier.verify(token);

        req.user = {
            id: payload.sub,
            email: payload.username,
            roles: payload['cognito:groups'] || []
        };
        req.token = token;
        req.userRole = req.user.roles.includes(ROLES.ADMIN) ? ROLES.ADMIN : (req.user.roles.includes(ROLES.MS_MEMBER) ? ROLES.MS_MEMBER : null);

        next();
    } catch (error) {
        console.error('Token verification failed:', error.message);
        return res.status(401).json({
            error: 'Unauthorized',
            message: 'Invalid or expired token'
        });
    }
};

/**
 * Middleware: Require specific role
 */
const requireRole = (...allowedRoles) => {
    return async (req, res, next) => {
        await requireAuth(req, res, async () => {
            const userRoles = req.user.roles || [];
            const hasRole = allowedRoles.some(role => userRoles.includes(role));

            if (hasRole) {
                next();
            } else {
                return res.status(403).json({
                    error: 'Forbidden',
                    message: `Required role: ${allowedRoles.join(' or ')}`
                });
            }
        });
    };
};

/**
 * Middleware for service-to-service authentication
 * Uses API key
 */
const requireServiceAuth = (req, res, next) => {
    const serviceKey = req.headers['x-service-key'];
    const expectedKey = process.env.SERVICE_KEY || 'my-secret-service-key';

    if (!serviceKey || serviceKey !== expectedKey) {
        return res.status(401).json({
            error: 'Unauthorized',
            message: 'Valid service key required'
        });
    }

    req.isServiceCall = true;
    next();
};

module.exports = {
    requireAuth,
    requireRole,
    requireServiceAuth,
    ROLES
};
