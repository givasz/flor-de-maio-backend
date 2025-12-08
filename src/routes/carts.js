const express = require("express");
const router = express.Router();
const prisma = require("../prismaClient");
const adminAuth = require("../middlewares/adminAuth");
const { customAlphabet } = require("nanoid");

const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5176";
const nanoid = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 8);

// Criar carrinho e gerar link único
// Payload esperado: { customerName, phone, note, deliveryMethod, address, items: [{ productId, qty }] }
router.post("/", async (req, res) => {
  const { customerName, phone, note, deliveryMethod, address, items } = req.body;

  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "Cart must have at least one item" });
  }

  // Gerar UID único
  let uid = nanoid();
  let exists = await prisma.cart.findUnique({ where: { uid } });
  let attempts = 0;

  while (exists && attempts < 5) {
    uid = nanoid();
    exists = await prisma.cart.findUnique({ where: { uid } });
    attempts++;
  }

  try {
    const cart = await prisma.cart.create({
      data: {
        uid,
        customerName,
        phone,
        note,
        deliveryMethod,
        address,
        items: {
          create: await Promise.all(
            items.map(async (item) => {
              const product = await prisma.product.findUnique({
                where: { id: parseInt(item.productId) },
              });
              if (!product) {
                throw new Error(`Product ${item.productId} not found`);
              }
              return {
                productId: product.id,
                qty: parseInt(item.qty),
                price: product.price,
              };
            })
          ),
        },
      },
      include: { items: true },
    });

    const link = `${FRONTEND_URL.replace(/\/$/, "")}/carrinho/${cart.uid}`;
    res.status(201).json({ cartId: cart.id, uid: cart.uid, link });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Visualizar carrinho por UID (público)
router.get("/:uid", async (req, res) => {
  const { uid } = req.params;

  try {
    const cart = await prisma.cart.findUnique({
      where: { uid },
      include: {
        items: {
          include: { product: true },
        },
      },
    });

    if (!cart) {
      return res.status(404).json({ error: "Carrinho não encontrado" });
    }

    res.json(cart);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Atualizar carrinho (apenas admin)
router.put("/:uid", adminAuth, async (req, res) => {
  const { uid } = req.params;
  const { items, customerName, phone, note, deliveryMethod, address } = req.body;

  try {
    const cart = await prisma.cart.findUnique({
      where: { uid },
      include: { items: true },
    });

    if (!cart) {
      return res.status(404).json({ error: "Carrinho não encontrado" });
    }

    // Deletar itens antigos e criar novos
    await prisma.cartItem.deleteMany({ where: { cartId: cart.id } });

    await Promise.all(
      items.map(async (item) => {
        const product = await prisma.product.findUnique({
          where: { id: parseInt(item.productId) },
        });
        if (!product) {
          throw new Error(`Product ${item.productId} not found`);
        }
        return prisma.cartItem.create({
          data: {
            cartId: cart.id,
            productId: product.id,
            qty: parseInt(item.qty),
            price: product.price,
          },
        });
      })
    );

    const updated = await prisma.cart.update({
      where: { id: cart.id },
      data: { customerName, phone, note, deliveryMethod, address },
      include: { items: { include: { product: true } } },
    });

    res.json(updated);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

module.exports = router;
