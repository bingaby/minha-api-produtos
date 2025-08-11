require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());
app.use(cors());
app.use(express.static('public')); // Servir arquivos estáticos

const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// Rota para buscar um produto por ID
app.get('/api/produtos/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const client = await pool.connect();
    const result = await client.query('SELECT * FROM produtos WHERE id = $1', [id]);
    client.release();
    if (result.rowCount === 0) {
      console.log(`Produto não encontrado: ID ${id}`);
      return res.status(404).json({ error: 'Produto não encontrado' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Erro ao buscar produto:', err);
    res.status(500).json({ error: 'Erro interno do servidor.' });
  }
});

// Rota para cadastrar um novo produto
app.post('/api/produtos', upload.array('imagens', 10), async (req, res) => {
  const { nome, descricao, preco, link, categoria, loja } = req.body;
  const imagens = req.files;

  console.log('Dados recebidos no POST:', { nome, descricao, preco, link, categoria, loja, imagens: imagens?.length });

  if (!nome || !descricao || !preco || !link || !categoria || !loja) {
    console.error('Campos obrigatórios faltando:', { nome, descricao, preco, link, categoria, loja });
    return res.status(400).json({ error: 'Todos os campos são obrigatórios.' });
  }

  if (nome.length > 255) {
    console.error('Nome excede limite:', nome);
    return res.status(400).json({ error: 'O nome do produto deve ter no máximo 255 caracteres.' });
  }
  if (descricao.length > 255) {
    console.error('Descrição excede limite:', descricao);
    return res.status(400).json({ error: 'A descrição deve ter no máximo 255 caracteres.' });
  }
  if (link.length > 255) {
    console.error('Link excede limite:', link);
    return res.status(400).json({ error: 'O link deve ter no máximo 255 caracteres.' });
  }
  if (loja.length > 255) {
    console.error('Loja excede limite:', loja);
    return res.status(400).json({ error: 'A loja deve ter no máximo 255 caracteres.' });
  }
  if (categoria.length > 255) {
    console.error('Categoria excede limite:', categoria);
    return res.status(400).json({ error: 'A categoria deve ter no máximo 255 caracteres.' });
  }

  const precoNum = parseFloat(preco);
  if (isNaN(precoNum) || precoNum < 0) {
    console.error('Preço inválido:', preco);
    return res.status(400).json({ error: 'O preço deve ser um número válido maior ou igual a zero.' });
  }

  try {
    const uploadedImages = imagens && imagens.length > 0
      ? await Promise.all(imagens.map(async (file) => {
          const result = await cloudinary.uploader.upload(`data:image/jpeg;base64,${file.buffer.toString('base64')}`, {
            folder: 'produtos',
          });
          return result.secure_url;
        }))
      : [];

    console.log('Imagens enviadas ao Cloudinary:', uploadedImages);

    const client = await pool.connect();
    const query = `
      INSERT INTO produtos (nome, descricao, preco, link, categoria, loja, imagens)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `;
    const values = [nome, descricao, precoNum, link, categoria, loja, uploadedImages];
    const result = await client.query(query, values);
    client.release();
    console.log('Produto cadastrado:', result.rows[0]);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Erro ao cadastrar produto:', err);
    res.status(500).json({ error: `Erro interno do servidor: ${err.message}` });
  }
});

// Rota para atualizar um produto
app.put('/api/produtos/:id', upload.array('imagens', 10), async (req, res) => {
  const { id } = req.params;
  const { nome, descricao, preco, link, categoria, loja } = req.body;
  const imagens = req.files;

  console.log('Dados recebidos no PUT:', { id, nome, descricao, preco, link, categoria, loja, imagens: imagens?.length });

  if (!nome || !descricao || !preco || !link || !categoria || !loja) {
    console.error('Campos obrigatórios faltando:', { nome, descricao, preco, link, categoria, loja });
    return res.status(400).json({ error: 'Todos os campos são obrigatórios.' });
  }

  if (nome.length > 255) {
    console.error('Nome excede limite:', nome);
    return res.status(400).json({ error: 'O nome do produto deve ter no máximo 255 caracteres.' });
  }
  if (descricao.length > 255) {
    console.error('Descrição excede limite:', descricao);
    return res.status(400).json({ error: 'A descrição deve ter no máximo 255 caracteres.' });
  }
  if (link.length > 255) {
    console.error('Link excede limite:', link);
    return res.status(400).json({ error: 'O link deve ter no máximo 255 caracteres.' });
  }
  if (loja.length > 255) {
    console.error('Loja excede limite:', loja);
    return res.status(400).json({ error: 'A loja deve ter no máximo 255 caracteres.' });
  }
  if (categoria.length > 255) {
    console.error('Categoria excede limite:', categoria);
    return res.status(400).json({ error: 'A categoria deve ter no máximo 255 caracteres.' });
  }

  const precoNum = parseFloat(preco);
  if (isNaN(precoNum) || precoNum < 0) {
    console.error('Preço inválido:', preco);
    return res.status(400).json({ error: 'O preço deve ser um número válido maior ou igual a zero.' });
  }

  try {
    const uploadedImages = imagens && imagens.length > 0
      ? await Promise.all(imagens.map(async (file) => {
          const result = await cloudinary.uploader.upload(`data:image/jpeg;base64,${file.buffer.toString('base64')}`, {
            folder: 'produtos',
          });
          return result.secure_url;
        }))
      : null;

    console.log('Imagens enviadas ao Cloudinary (PUT):', uploadedImages);

    const client = await pool.connect();
    const query = `
      UPDATE produtos 
      SET nome = $1, descricao = $2, preco = $3, link = $4, categoria = $5, loja = $6, imagens = COALESCE($7, imagens)
      WHERE id = $8
      RETURNING *
    `;
    const values = [nome, descricao, precoNum, link, categoria, loja, uploadedImages, id];
    const result = await client.query(query, values);
    client.release();

    if (result.rowCount === 0) {
      console.error('Produto não encontrado:', id);
      return res.status(404).json({ error: 'Produto não encontrado' });
    }
    console.log('Produto atualizado:', result.rows[0]);
    res.json
