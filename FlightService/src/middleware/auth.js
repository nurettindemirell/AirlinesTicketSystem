const { CognitoJwtVerifier } = require("aws-jwt-verify");
const config = require('../config/cognito');

// User roles mapped to Cognito Groups
const ROLES = {
    ADMIN: 'ADMIN', // Corresponds to Cognito group 'ADMIN'
    MS_MEMBER: 'MS_MEMBER' // Corresponds to Cognito group 'MS_MEMBER'
};

// Create the verifier
// We only support internal user pool for now
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
 * Middleware: Require authentication and optionally specific groups (roles)
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

        // Transform payload to match expected user object structure
        req.user = {
            id: payload.sub,
            email: payload.username, // or payload['cognito:username']
            // Extract groups from payload
            roles: payload['cognito:groups'] || []
        };
        req.token = token;

        console.log(`👤 Authenticated: ${req.user.id} (Roles: ${req.user.roles.join(', ')})`);

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
 * Middleware: Require specific role (Cognito Group)
 */
const requireRole = (roleName) => {
    return async (req, res, next) => {
        // First ensure authenticated
        await requireAuth(req, res, async () => {
            // Check if user has the required group
            if (req.user && req.user.roles && req.user.roles.includes(roleName)) {
                next();
            } else {
                return res.status(403).json({
                    error: 'Forbidden',
                    message: `Required role: ${roleName}`
                });
            }
        });
    };
};

// Optional auth - attempts to verify but doesn't block if failed
const optionalAuth = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return next();
    }

    // Attempt verification but don't error out
    try {
        if (verifier) {
            const token = authHeader.split(' ')[1];
            const payload = await verifier.verify(token);
            req.user = {
                id: payload.sub,
                email: payload.username,
                roles: payload['cognito:groups'] || []
            };
        }
    } catch (e) {
        // Ignore error for optional auth
    }
    next();
};

module.exports = {
    requireAuth,
    requireRole,
    optionalAuth,
    ROLES
};
