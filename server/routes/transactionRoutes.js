import express from "express";
import mongoose from "mongoose";
import Customer from "../models/Customer.js";
import Transaction from "../models/Transaction.js";
import { getCustomerLedger, getDashboardSummary } from "../services/ledgerService.js";

const router = express.Router();

function parseAmount(value) {
  const amount = typeof value === "number" ? value : Number(value);

  if (!Number.isFinite(amount) || amount < 1) return null;

  return Math.round(amount * 100) / 100;
}

router.get("/summary", async (req, res) => {
  try {
    const summary = await getDashboardSummary();

    res.json({
      success: true,
      summary,
    });
  } catch (error) {
    console.error("Dashboard summary failed:", error.message);
    res.status(500).json({
      success: false,
      message: "Could not retrieve dashboard summary.",
    });
  }
});

router.get("/customer/:id", async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid customer id.",
      });
    }

    const customer = await Customer.findById(req.params.id).lean();

    if (!customer) {
      return res.status(404).json({
        success: false,
        message: "Customer not found.",
      });
    }

    const [transactions, ledger] = await Promise.all([
      Transaction.find({ customerId: customer._id }).sort({ transactionDate: -1, createdAt: -1 }),
      getCustomerLedger(customer._id),
    ]);

    res.json({
      success: true,
      customer,
      ledger,
      transactions,
    });
  } catch (error) {
    console.error("Customer history failed:", error.message);
    res.status(500).json({
      success: false,
      message: "Could not retrieve customer history.",
    });
  }
});

router.get("/", async (req, res) => {
  try {
    const transactions = await Transaction.find()
      .sort({ transactionDate: -1, createdAt: -1 })
      .populate("customerId", "name phone");

    res.json({
      success: true,
      transactions,
    });
  } catch (error) {
    console.error("List transactions failed:", error.message);
    res.status(500).json({
      success: false,
      message: "Could not retrieve transactions.",
    });
  }
});

router.post("/", async (req, res) => {
  try {
    const { customerId, type, description, source, transactionDate, confirmed } = req.body;

    if (!mongoose.Types.ObjectId.isValid(customerId)) {
      return res.status(400).json({
        success: false,
        message: "A valid customer is required.",
      });
    }

    if (type !== "CREDIT" && type !== "PAYMENT") {
      return res.status(400).json({
        success: false,
        message: "Transaction type must be CREDIT or PAYMENT.",
      });
    }

    const amount = parseAmount(req.body.amount);

    if (amount === null) {
      return res.status(400).json({
        success: false,
        message: "Amount must be at least 1.",
      });
    }

    if (confirmed === false) {
      return res.status(400).json({
        success: false,
        message: "Transaction must be confirmed before it is saved.",
      });
    }

    const customer = await Customer.findById(customerId);

    if (!customer) {
      return res.status(404).json({
        success: false,
        message: "Customer not found.",
      });
    }

    const transactionSource = source === "VOICE" ? "VOICE" : "MANUAL";

    if (transactionSource === "VOICE" && confirmed !== true) {
      return res.status(400).json({
        success: false,
        message: "A voice transaction must be confirmed before it is saved.",
      });
    }

    const transaction = await Transaction.create({
      customerId,
      type,
      amount,
      description: typeof description === "string" ? description.trim() : "",
      source: transactionSource,
      ...(transactionDate ? { transactionDate } : {}),
    });

    const ledger = await getCustomerLedger(customerId);

    res.status(201).json({
      success: true,
      transaction,
      ledger,
    });
  } catch (error) {
    console.error("Create transaction failed:", error.message);
    res.status(500).json({
      success: false,
      message: "Could not create transaction.",
    });
  }
});

export default router;
