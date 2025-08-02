import express from 'express';
import dotenv from 'dotenv';
import pkg from 'pg';
import multer from 'multer';
import { v2 as cloudinary } from 'cloudinary';
import streamifier from 'streamifier';
import path from 'path';

dotenv.config();

const { Pool } = pkg;
const app = express();
const port = process.env.PORT || 3000;

// Middleware JSON e serve arquivos estáticos da pasta "public"
app.use(express.json());
app.use(express.static(path.resolve('public')));

// Configuração PostgreSQL
const pool = new Pool({
  user: process.env.PGUSER,
  host: process.env.PGHOST,
  database: process.env.PGDATABASE,
  password: process.env.PGPASSWORD,
  port: 5432,
  ssl: { rejectUnauthorized: false }, // importante para Render.com
});

// Configuração Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Multer para upload de imagens em memória
const upload = multer({ storage: multer.memoryStorage() });

// Criar tabela produtos se não existir (com id serial, nome, categoria, loja, link, imagens JSON)
async function criarTabela() {
  const query = `
    CREATE TABLE IF NOT EXISTS produtos (
      id SERIAL PRIMARY KEY,
      nome VARCHAR(255) NOT NULL,
      categoria VARCHAR(100) NOT NULL,
      loja VARCHAR(100) NOT NULL,
      link TEXT NOT NULL,
      imagens JSON NOT NULL
    );
  `;
  await pool.query(query);
}
criarTabela().catch(console.error);

// Rota para listar produtos
app.get('/api/produtos', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM produtos ORDER BY id DESC');
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao listar produtos' });
  }
});

// Rota para adicionar produto com upload de múltiplas imagens
app.post('/api/produtos', upload.array('imagens', 3), async (req, res) => {
  try {
    const { nome, categoria, loja, link } = req.body;
    if (!nome || !categoria || !loja || !link) {
      return res.status(400).json({ error: 'Campos obrigatórios faltando' });
    }
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'É necessário enviar ao menos uma imagem' });
    }

    // Upload das imagens para Cloudinary
    const urls = await Promise.all(req.files.map(file => {
      return new Promise((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
          { folder: 'produtos' },
          (error, result) => {
            if (error) return reject(error);
            resolve(result.secure_url);
          }
        );
        streamifier.createReadStream(file.buffer).pipe(uploadStream);
      });
    }));

    // Salvar no banco
    const query = `
      INSERT INTO produtos (nome, categoria, loja, link, imagens)
      VALUES ($1, $2, $3, $4, $5) RETURNING *;
    `;
    const values = [nome, categoria, loja, link, JSON.stringify(urls)];
    const { rows } = await pool.query(query, values);

    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao adicionar produto' });
  }
});

// Rota para deletar produto por ID
app.delete('/api/produtos/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    await pool.query('DELETE FROM produtos WHERE id = $1', [id]);
    res.json({ message: 'Produto excluído com sucesso' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao excluir produto' });
  }
});

// Iniciar servidor
app.listen(port, () => {
  console.log(`Servidor rodando em http://localhost:${port}`);
});
