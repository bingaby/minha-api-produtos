const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const app = express();

// Configurar CORS para permitir requisições do frontend
const cors = require('cors');
app.use(cors());

// Configurar pasta estática para servir imagens
app.use('/upload', express.static(path.join(__dirname, 'upload')));

// Configurar multer para salvar imagens na pasta 'upload'
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, 'upload');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir);
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, `${uniqueSuffix}-${file.originalname}`);
  },
});
const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif'];
    if (!allowedTypes.includes(file.mimetype)) {
      return cb(new Error('Apenas imagens JPEG, PNG ou GIF são permitidas.'));
    }
    cb(null, true);
  },
  limits: { fileSize: 5 * 1024 * 1024 }, // Limite de 5MB por arquivo
});

// Simulação de banco de dados (substitua por MongoDB, MySQL, etc.)
let produtos = [];

// Rota para cadastrar produto
app.post('/api/produtos', upload.array('imagens', 5), (req, res) => {
  try {
    const { nome, categoria, loja, link } = req.body;
    const imagens = req.files.map(file => `/upload/${file.filename}`);

    if (!nome || !categoria || !loja || imagens.length === 0) {
      return res.status(400).json({ details: 'Campos obrigatórios ausentes' });
    }

    const produto = {
      id: produtos.length + 1,
      nome,
      categoria,
      loja,
      imagens,
      link: link || '',
    };

    produtos.push(produto);
    res.status(201).json({ message: 'Produto cadastrado com sucesso', produto });
  } catch (error) {
    console.error('Erro ao cadastrar produto:', error);
    res.status(500).json({ details: error.message });
  }
});

// Rota para listar produtos
app.get('/api/produtos', (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 24;
  const start = (page - 1) * limit;
  const end = start + limit;

  const produtosPaginados = produtos.slice(start, end);
  res.json({
    produtos: produtosPaginados,
    total: produtos.length,
  });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
