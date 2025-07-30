require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { Pool } = require('pg');
const cloudinary = require('cloudinary').v2;
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(cors());
app.use(express.json());

// === Configuração do PostgreSQL ===
const pool = new Pool({
  user: process.env.PGUSER,
  host: process.env.PGHOST,
  database: process.env.PGDATABASE,
  password: process.env.PGPASSWORD,
  port: 5432,
  ssl: { rejectUnauthorized: false }
});

// === Configuração do Cloudinary ===
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// === Configuração do Multer (upload local antes do Cloudinary) ===
const storage = multer.memoryStorage();
const upload = multer({ storage });

// === Rota de teste ===
app.get('/', (req, res) => {
  res.send('API do Centro de Compra online!');
});

// === Rota para adicionar produto ===
app.post('/api/produtos', upload.single('imagem'), async (req, res) => {
  try {
    const { nome, descricao, preco, categoria, loja } = req.body;

    // Faz upload para o Cloudinary
    const result = await cloudinary.uploader.upload_stream(
      { folder: 'produtos' },
      async (error, result) => {
        if (error) return res.status(500).json({ erro: 'Erro no upload da imagem' });

        const imagem = result.secure_url;

        const query = `
          INSERT INTO produtos (nome, descricao, preco, imagem, categoria, loja)
          VALUES ($1, $2, $3, $4, $5, $6) RETURNING *
        `;
        const values = [nome, descricao, preco, imagem, categoria, loja];
        const insert = await pool.query(query, values);

        io.emit('novo-produto', insert.rows[0]); // WebSocket para atualizar ao vivo
        res.status(201).json(insert.rows[0]);
      }
    );

    // Envia a imagem para o Cloudinary
    result.end(req.file.buffer);
  } catch (error) {
    res.status(500).json({ erro: 'Erro ao adicionar produto' });
  }
});

// === Rota para buscar produtos ===
app.get('/api/produtos', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM produtos ORDER BY id DESC');
    res.json(rows);
  } catch (error) {
    res.status(500).json({ erro: 'Erro ao buscar produtos' });
  }
});

// === WebSocket ===
io.on('connection', (socket) => {
  console.log('Cliente conectado:', socket.id);
});

// === Start do servidor ===
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
