require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());
app.use(cors({ origin: 'https://<seu-usuario>.github.io' })); // Permitir GitHub Pages
app.use(express.static('public')); // Servir arquivos estáticos, se necessário

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

// Rota de teste
app.get('/api/test', (req, res) => {
  res.json({ message: 'Servidor funcionando' });
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

  if (nome.length > 255 || descricao.length > 255 || link.length > 255 || loja.length > 255 || categoria.length > 255) {
    console.error('Limite de caracteres excedido');
    return res.status(400).json({ error: 'Os campos devem ter no máximo 255 caracteres.' });
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
            transformation: [{ width: 300, height: 300, crop: 'fill' }],
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

  if (nome.length > 255 || descricao.length > 255 || link.length > 255 || loja.length > 255 || categoria.length > 255) {
    console.error('Limite de caracteres excedido');
    return res.status(400).json({ error: 'Os campos devem ter no máximo 255 caracteres.' });
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
            transformation: [{ width: 300, height: 300, crop: 'fill' }],
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
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Erro ao atualizar produto:', err);
    res.status(500).json({ error: `Erro interno do servidor: ${err.message}` });
  }
});

// Rota para buscar todos os produtos com filtros e paginação
app.get('/api/produtos', async (req, res) => {
  const { page = 1, limit = 12, categoria, loja, busca, sort = 'relevance' } = req.query;
  const offset = (page - 1) * limit;

  console.log('Parâmetros GET /api/produtos:', { page, limit, categoria, loja, busca, sort });

  try {
    const client = await pool.connect();
    let query = 'SELECT * FROM produtos';
    const values = [];
    const conditions = [];

    if (categoria && categoria !== 'todas') {
      conditions.push(`categoria = $${values.length + 1}`);
      values.push(categoria);
    }
    if (loja && loja !== 'todas') {
      conditions.push(`loja = $${values.length + 1}`);
      values.push(loja);
    }
    if (busca) {
      conditions.push(`(nome ILIKE $${values.length + 1} OR descricao ILIKE $${values.length + 1})`);
      values.push(`%${busca}%`);
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }

    switch (sort) {
      case 'price-low':
        query += ' ORDER BY preco ASC';
        break;
      case 'price-high':
        query += ' ORDER BY preco DESC';
        break;
      case 'newest':
        query += ' ORDER BY created_at DESC';
        break;
      default:
        query += ' ORDER BY id DESC';
    }

    query += ' LIMIT $' + (values.length + 1) + ' OFFSET $' + (values.length + 2);
    values.push(limit, offset);

    const result = await client.query(query, values);
    const countQuery = 'SELECT COUNT(*) FROM produtos' + (conditions.length > 0 ? ' WHERE ' + conditions.join(' AND ') : '');
    const countResult = await client.query(countQuery, values.slice(0, -2));
    const total = parseInt(countResult.rows[0].count);

    client.release();
    console.log('Produtos retornados:', result.rows.length, 'Total:', total);
    res.json({ data: result.rows, total });
  } catch (err) {
    console.error('Erro ao buscar produtos:', err);
    res.status(500).json({ error: 'Erro interno do servidor.' });
  }
});

// Rota para excluir um produto
app.delete('/api/produtos/:id', async (req, res) => {
  const { id } = req.params;
  console.log('Excluindo produto:', id);
  try {
    const client = await pool.connect();
    const query = 'DELETE FROM produtos WHERE id = $1 RETURNING *';
    const result = await client.query(query, [id]);
    client.release();

    if (result.rowCount === 0) {
      console.error('Produto não encontrado para exclusão:', id);
      return res.status(404).json({ error: 'Produto não encontrado' });
    }
    console.log('Produto excluído:', result.rows[0]);
    res.json({ message: `Produto com ID ${id} excluído com sucesso`, produto: result.rows[0] });
  } catch (err) {
    console.error('Erro ao excluir produto:', err);
    res.status(500).json({ error: 'Erro interno do servidor.' });
  }
});

// Middleware para erros genéricos
app.use((err, req, res, next) => {
  console.error('Erro no servidor:', err);
  res.status(500).json({ error: 'Erro interno do servidor.' });
});

// Middleware para rotas não encontradas
app.use((req, res) => {
  console.error('Rota não encontrada:', req.method, req.url);
  res.status(404).json({ error: 'Rota não encontrada' });
});

app.listen(port, () => {
  console.log(`Servidor rodando na porta ${port}`);
});
