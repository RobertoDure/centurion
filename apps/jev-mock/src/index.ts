import { DEFAULT_PORT, buildServer, createOptionsFromEnv } from './server';

const port = Number(process.env.PORT ?? DEFAULT_PORT);
const app = buildServer(createOptionsFromEnv());

const address = await app.listen({ port, host: '0.0.0.0' });
console.log('jev-mock listening on ' + address);
