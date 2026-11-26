import { getDashboardSummary } from "../services/ledgerService.js";
import express from "express";
import mongoose from "mongoose";
import Customer from "../models/Customer.js";
import Transaction from "../models/Transaction.js";
import { attachLedgers, getCustomerLedger } from "../services/ledgerService.js";

const router = express.Router();

function cleanName(value) {
  return typeof value === "string" ? value.trim() : "";
}

function cleanPhone(value) {
  if (typeof value !== "string") return null;
  const phone = value.trim();
  return phone || null;
}

// Insights endpoint - must come before /:id route
router.get("/insights", async (req, res) => {
  try {
    const customers = await Customer.find().sort({ createdAt: -1 }).lean();
    const customersWithBalances = await attachLedgers(customers);

    // Rank by outstanding balance (descending)
    const rankedCustomers = customersWithBalances
      .sort((a, b) => b.outstanding - a.outstanding)
      .slice(0, 5)
      .map((customer) => ({
        id: customer.id,
        name: customer.name,
        phone: customer.phone,
        totalCredit: customer.totalCredit,
        totalPayment: customer.totalPayment,
        outstanding: customer.outstanding,
      }));

    res.json({
      success: true,
      rankedCustomers,
      totalCustomers: customers.length,
    });
  } catch (error) {
    console.error("Customer insights failed:", error.message);
    res.status(500).json({
      success: false,
      message: "Could not retrieve customer insights.",
    });
  }
});

// Enhanced dashboard endpoint - must come before /:id route
router.get("/dashboard/enhanced", async (req, res) => {
  try {
    const [dashboardSummary, customersWithBalances, allTransactions] = await Promise.all([
      getDashboardSummary(),
      attachLedgers(await Customer.find().sort({ createdAt: -1 }).lean()),
      Transaction.find()
        .sort({ transactionDate: -1, createdAt: -1 })
        .limit(10)
        .populate("customerId", "name phone"),
    ]);

    // Top 5 customers by outstanding balance
    const topCustomers = customersWithBalances
      .sort((a, b) => b.outstanding - a.outstanding)
      .slice(0, 5)
      .map((customer) => ({
        id: customer.id,
        name: customer.name,
        outstanding: customer.outstanding,
      }));

    // Recent transactions formatted for dashboard
    const recentTransactions = allTransactions.map((tx) => ({
      id: tx.id,
      customerName: tx.customerId?.name || "Unknown",
      type: tx.type,
      amount: tx.amount,
      date: tx.transactionDate,
    }));

    res.json({
      success: true,
      dashboard: {
        totalCustomers: dashboardSummary.totalCustomers,
        todayCredit: dashboardSummary.todayCredit,
        todayPayment: dashboardSummary.todayPayment,
        totalOutstanding: dashboardSummary.totalOutstanding,
      },
      topCustomers,
      recentTransactions,
    });
  } catch (error) {
    console.error("Enhanced dashboard failed:", error.message);
    res.status(500).json({
      success: false,
      message: "Could not retrieve enhanced dashboard data.",
    });
  }
});

// Create customer
router.post("/", async (req, res) => {
  try {
    const name = cleanName(req.body.name);

    if (!name) {
      return res.status(400).json({
        success: false,
        message: "Customer name is required.",
      });
    }

    const customer = await Customer.create({
      name,
      phone: cleanPhone(req.body.phone),
      reminderOptIn: Boolean(req.body.reminderOptIn),
    });

    res.status(201).json({
      success: true,
      customer,
    });
  } catch (error) {
    console.error("Create customer failed:", error.message);
    res.status(500).json({
      success: false,
      message: "Could not create customer.",
    });
  }
});

router.get("/", async (req, res) => {
  try {
    const customers = await Customer.find().sort({ createdAt: -1 }).lean();
    const customersWithBalances = await attachLedgers(customers);

    res.json({
      success: true,
      customers: customersWithBalances,
    });
  } catch (error) {
    console.error("List customers failed:", error.message);
    res.status(500).json({
      success: false,
      message: "Could not retrieve customers.",
    });
  }
});

router.get("/:id", async (req, res) => {
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

    const ledger = await getCustomerLedger(customer._id);

    res.json({
      success: true,
      customer: {
        ...customer,
        ...ledger,
      },
    });
  } catch (error) {
    console.error("Get customer failed:", error.message);
    res.status(500).json({
      success: false,
      message: "Could not retrieve customer.",
    });
  }
});

router.put("/:id", async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid customer id.",
      });
    }

    const name = cleanName(req.body.name);

    if (!name) {
      return res.status(400).json({
        success: false,
        message: "Customer name is required.",
      });
    }

    const customer = await Customer.findByIdAndUpdate(
      req.params.id,
      {
        name,
        phone: cleanPhone(req.body.phone),
        reminderOptIn: Boolean(req.body.reminderOptIn),
      },
      { new: true, runValidators: true }
    ).lean();

    if (!customer) {
      return res.status(404).json({
        success: false,
        message: "Customer not found.",
      });
    }

    const ledger = await getCustomerLedger(customer._id);

    res.json({
      success: true,
      customer: {
        ...customer,
        ...ledger,
      },
    });
  } catch (error) {
    console.error("Update customer failed:", error.message);
    res.status(500).json({
      success: false,
      message: "Could not update customer.",
    });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid customer id.",
      });
    }

    const hasTransactions = await Transaction.exists({ customerId: req.params.id });

    if (hasTransactions) {
      return res.status(409).json({
        success: false,
        message: "Cannot delete a customer who has ledger transactions.",
      });
    }

    const customer = await Customer.findByIdAndDelete(req.params.id);

    if (!customer) {
      return res.status(404).json({
        success: false,
        message: "Customer not found.",
      });
    }

    res.json({
      success: true,
      message: "Customer deleted.",
    });
  } catch (error) {
    console.error("Delete customer failed:", error.message);
    res.status(500).json({
      success: false,
      message: "Could not delete customer.",
    });
  }
});

export default router;