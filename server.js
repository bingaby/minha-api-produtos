const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const app = express();
const port = process.env.PORT || 10000;

// Middleware
app.use(cors());
app.use(express.json());

// Servir arquivos estáticos da pasta public/uploads
app.use('/uploads', express.static(path.join(__dirname, 'public/uploads')));

// Configurar pasta de upload
const uploadDir = path.join(__dirname, 'public/uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Configurar Multer para upload de múltiplas imagens
const storage = mutex.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, `${uniqueSuffix}-${file.originalname}`);
  }
});
const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const filetypes = /jpeg|jpg|png|gif/;
    const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = filetypes.test(file.mimetype);
    if (extname && mimetype) {
      cb(null, true);
    } else {
      cb(new Error('Apenas imagens JPEG, PNG ou GIF são permitidas'));
    }
  },
  limits: { fileSize: 5 * 1024 * 1024 } // Limite de 5MB por imagem
});

// Conectar ao MongoDB
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/minha-api-produtos', {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => {
  console.log('Conectado ao MongoDB');
}).catch(err => {
  console.error('Erro ao conectar ao MongoDB:', err);
});

// Esquema do Produto
const produtoSchema = new mongoose.Schema({
  nome: { type: String, required: true },
  categoria: { type: String, required: true },
  loja: { type: String, required: true },
  imagens: { type: [String], default: [] }, // Armazena URLs das imagens
  link: { type: String }
});

const Produto = mongoose.model('Produto', produtoSchema);

// Rota para buscar produtos (usada pela página principal)
app.get('/api/produtos', async (req, res) => {
  try {
    const { page = 1, limit = 24 } = req.query;
    const skip = (page - 1) * limit;
    const produtos = await Produto.find()
      .skip(skip)
      .limit(parseInt(limit));
    const total = await Produto.countDocuments();
    res.json({ produtos, total });
  } catch (error) {
    res.status(500).json({ details: 'Erro ao buscar produtos: ' + error.message });
  }
});

// Rota para cadastrar produtos (usada pela página admin-xyz-123.html)
app.post('/api/produtos', upload.array('imagens', 5), async (req, res) => {
  try {
    const { nome, categoria, loja, link } = req.body;
    if (!nome || !categoria || !loja) {
      return res.status(400).json({ details: 'Campos obrigatórios: nome, categoria, loja' });
    }
    const imagens = req.files.map(file => `/uploads/${file.filename}`);
    const produto = new Produto({ nome, categoria, loja, imagens, link });
    await produto.save();
    res.status(201).json({ message: 'Produto cadastrado com sucesso' });
  } catch (error) {
    res.status(500).json({ details: 'Erro ao cadastrar produto: ' + error.message });
  }
});

// Iniciar o servidor
app.listen(port, () => {
  console.log(`Servidor rodando na porta ${port}`);
});
