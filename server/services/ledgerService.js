import mongoose from "mongoose";
import Customer from "../models/Customer.js";
import Transaction from "../models/Transaction.js";

const CREDIT = "CREDIT";
const PAYMENT = "PAYMENT";

export function calculateOutstanding(totalCredit, totalPayment) {
  return totalCredit - totalPayment;
}

function emptyLedger() {
  return {
    totalCredit: 0,
    totalPayment: 0,
    outstanding: 0,
  };
}

function istDayRange(date = new Date()) {
  const dateKey = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);

  const start = new Date(`${dateKey}T00:00:00+05:30`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);

  return { start, end };
}

export async function getCustomerLedger(customerId) {
  const rows = await Transaction.aggregate([
    { $match: { customerId: new mongoose.Types.ObjectId(String(customerId)) } },
    {
      $group: {
        _id: "$type",
        total: { $sum: "$amount" },
      },
    },
  ]);

  const ledger = emptyLedger();

  for (const row of rows) {
    if (row._id === CREDIT) ledger.totalCredit = row.total;
    if (row._id === PAYMENT) ledger.totalPayment = row.total;
  }

  ledger.outstanding = calculateOutstanding(ledger.totalCredit, ledger.totalPayment);
  return ledger;
}

export async function attachLedgers(customers) {
  if (customers.length === 0) return [];

  const ids = customers.map((customer) => customer._id);
  const rows = await Transaction.aggregate([
    { $match: { customerId: { $in: ids } } },
    {
      $group: {
        _id: "$customerId",
        totalCredit: {
          $sum: { $cond: [{ $eq: ["$type", CREDIT] }, "$amount", 0] },
        },
        totalPayment: {
          $sum: { $cond: [{ $eq: ["$type", PAYMENT] }, "$amount", 0] },
        },
      },
    },
  ]);

  const byCustomer = new Map(rows.map((row) => [String(row._id), row]));

  return customers.map((customer) => {
    const row = byCustomer.get(String(customer._id));
    const totalCredit = row?.totalCredit || 0;
    const totalPayment = row?.totalPayment || 0;

    return {
      ...customer,
      totalCredit,
      totalPayment,
      outstanding: calculateOutstanding(totalCredit, totalPayment),
    };
  });
}

export async function getDashboardSummary() {
  const { start, end } = istDayRange();

  const [totalCustomers, rows] = await Promise.all([
    Customer.countDocuments(),
    Transaction.aggregate([
      {
        $group: {
          _id: "$type",
          total: { $sum: "$amount" },
          today: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $gte: ["$transactionDate", start] },
                    { $lt: ["$transactionDate", end] },
                  ],
                },
                "$amount",
                0,
              ],
            },
          },
        },
      },
    ]),
  ]);

  let totalCredit = 0;
  let totalPayment = 0;
  let todayCredit = 0;
  let todayPayments = 0;

  for (const row of rows) {
    if (row._id === CREDIT) {
      totalCredit = row.total;
      todayCredit = row.today;
    }

    if (row._id === PAYMENT) {
      totalPayment = row.total;
      todayPayments = row.today;
    }
  }

  return {
    todayCredit,
    todayPayments,
    totalOutstanding: calculateOutstanding(totalCredit, totalPayment),
    totalCustomers,
  };
}
