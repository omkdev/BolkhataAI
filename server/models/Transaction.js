import mongoose from "mongoose";

const transactionSchema = new mongoose.Schema(
  {
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Customer",
      required: true,
      index: true,
    },

    type: {
      type: String,
      enum: ["CREDIT", "PAYMENT"],
      required: true,
    },

    amount: {
      type: Number,
      required: true,
      min: 1,
    },

    transactionDate: {
      type: Date,
      default: Date.now,
    },

    description: {
      type: String,
      default: "",
    },

    source: {
      type: String,
      enum: ["VOICE", "MANUAL"],
      default: "MANUAL",
    },
  },
  { timestamps: true }
);

export default mongoose.model("Transaction", transactionSchema);
