import express from 'express'
import apiRouter from './routes/Api.routes'
import cors from 'cors'
import * as dotenv from 'dotenv'
import { login, verify } from './controllers/authController';
import path from 'path';
import * as fs from 'fs-extra';
import { queryFileWithoutDownload } from './controllers/Flock.Controller';


dotenv.config();

const app = express()

const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://127.0.0.1:5500,http://localhost:5500,https://iea-chat.vercel.app')
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean);

app.use(cors({
  origin: allowedOrigins,
  credentials: true
}));
app.use(express.json())

app.use('/api', apiRouter);

// Serve storage folder (attachments saved locally)
const storagePath = path.join(__dirname, '../../storage');
fs.ensureDirSync(storagePath);
app.use('/storage', express.static(storagePath));

const appName = process.env.APP_NAME || "API Rest - IEASRL"
app.get('/', async (req, res) => {
  res.json({
    message: appName
  })
})

const port = process.env.port || 3000

function printRoutes(app: express.Application) {
  const router = app._router;
  const routes: string[] = [];
  router.stack.forEach((layer: any) => {
    if (layer.route) {
      const methods = Object.keys(layer.route.methods).join(',');
      routes.push(`${methods.toUpperCase()} ${layer.route.path}`);
    } else if (layer.name === 'router' && layer.handle.stack) {
      layer.handle.stack.forEach((subLayer: any) => {
        if (subLayer.route) {
          const methods = Object.keys(subLayer.route.methods).join(',');
          routes.push(`${methods.toUpperCase()} ${layer.regexp.source.replace(/\\\//g, '/')}${subLayer.route.path}`);
        }
      });
    }
  });
  console.log('📌 Rutas registradas:');
  routes.forEach(r => console.log('   ', r));
}

printRoutes(app);

const server = app.listen(port, () =>
  console.log(`Servidor escuchando: http://localhost:${port}`),
)

app.post('/api/auth/login', login);
app.post('/api/auth/verify', verify);
