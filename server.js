import express from 'express';
import pkg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pkg;

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());

const pool = new Pool({
  user: process.env.PGUSER,
  host: process.env.PGHOST,
  database: process.env.PGDATABASE,
  password: process.env.PGPASSWORD,
  port: 5432,
  ssl: {
    rejectUnauthorized: false // necessário para Render.com
  }
});

// Resto das rotas (GET, POST, PUT, DELETE) aqui...

app.listen(port, () => {
  console.log(`Servidor rodando na porta ${port}`);
});
