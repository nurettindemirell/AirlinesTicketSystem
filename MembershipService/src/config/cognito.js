module.exports = {
    userPoolId: process.env.AWS_COGNITO_USER_POOL_ID,
    clientId: process.env.AWS_COGNITO_CLIENT_ID,
    region: process.env.AWS_REGION || 'us-east-1'
};
