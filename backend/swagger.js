import swaggerJsdoc from 'swagger-jsdoc';

const options = {
    definition: {
        openapi: '3.0.0',
        info: {
            title: 'Halla Bol API',
            version: '1.0.0',
            description: 'API documentation for Halla Bol social media management backend'
        },
        servers: [
            { url: 'http://localhost:5000', description: 'Local dev' }
            // add your production URL here once deployed
        ],
        components: {
            securitySchemes: {
                bearerAuth: {
                    type: 'http',
                    scheme: 'bearer',
                    bearerFormat: 'JWT'
                }
            }
        },
        security: [{ bearerAuth: [] }]
    },
    apis: ['./routes/*.js'] // scans JSDoc comments in all route files
};

export const swaggerSpec = swaggerJsdoc(options);