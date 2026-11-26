import { useState, useEffect, useRef } from "react";
import "./App.css";
import { Menu, Plus } from "lucide-react";
import { api } from "./api";

function App() {
  // ----------------------------------
  // Application state
  // ----------------------------------

  const [view, setView] = useState(() => {
    const storedView = localStorage.getItem("bolkhata-view");

    const validViews = [
      "dashboard",
      "customers",
      "customer-detail",
      "add-transaction",
      "voice",
    ];

    return validViews.includes(storedView) ? storedView : "dashboard";
  });

  const [searchTerm, setSearchTerm] = useState("");

  const [customers, setCustomers] = useState([]);
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [transactions, setTransactions] = useState([]);

  const [dashboard, setDashboard] = useState(null);
  const [enhancedDashboard, setEnhancedDashboard] = useState(null);
  const [customerInsights, setCustomerInsights] = useState([]);

  const [voiceTranscript, setVoiceTranscript] = useState("");
  const [voiceConfirmation, setVoiceConfirmation] = useState(null);
  const [voiceListening, setVoiceListening] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const voiceSocketRef = useRef(null);
  const voiceStreamRef = useRef(null);
  const voiceContextRef = useRef(null);
  const voiceSourceRef = useRef(null);
  const voiceNodeRef = useRef(null);
  const voiceGainRef = useRef(null);

  const [openModal, setOpenModal] = useState(null);
  const [modalData, setModalData] = useState(null);

  const [formError, setFormError] = useState(null);
  const [successMessage, setSuccessMessage] = useState(null);
  const [loading, setLoading] = useState(false);

  // ----------------------------------
  // Gnani AI TTS and Voice
  // ----------------------------------

  const speakText = async (text) => {
    try {
      const audioBlob = await api.speak(text);
      const audioUrl = URL.createObjectURL(audioBlob);
      const audio = new Audio(audioUrl);

      audio.onended = () => URL.revokeObjectURL(audioUrl);
      await audio.play();
    } catch (error) {
      console.error("Gnani TTS error:", error);
    }
  };

  const stopVoiceListening = () => {
    setIsConnecting(false);
    voiceNodeRef.current?.disconnect();
    voiceSourceRef.current?.disconnect();
    voiceGainRef.current?.disconnect();

    voiceStreamRef.current?.getTracks().forEach((track) => track.stop());

    if (voiceSocketRef.current?.readyState === WebSocket.OPEN) {
      voiceSocketRef.current.close();
    }

    voiceContextRef.current?.close();

    voiceSocketRef.current = null;
    voiceStreamRef.current = null;
    voiceContextRef.current = null;
    voiceSourceRef.current = null;
    voiceNodeRef.current = null;
    voiceGainRef.current = null;

    setVoiceListening(false);
  };

  const startVoiceListening = async () => {
    try {
      setFormError(null);

      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Microphone access requires HTTPS or localhost.");
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });

      const audioContext = new AudioContext({ sampleRate: 16000 });

      await audioContext.audioWorklet.addModule("/pcm-worklet.js");

      const backend = (
        import.meta.env.VITE_API_URL || "http://localhost:5000"
      ).replace(/\/+$/, "");

      const socketUrl = backend.replace(/^http/, "ws") + "/api/voice/stream";
      const socket = new WebSocket(socketUrl);
      socket.binaryType = "arraybuffer";

      voiceStreamRef.current = stream;
      voiceContextRef.current = audioContext;
      voiceSocketRef.current = socket;

      socket.onopen = () => {
        const source = audioContext.createMediaStreamSource(stream);
        const worklet = new AudioWorkletNode(audioContext, "pcm-capture");
        const silentGain = audioContext.createGain();
        silentGain.gain.value = 0;

        worklet.port.onmessage = (event) => {
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(event.data);
          }
        };

        source.connect(worklet);
        worklet.connect(silentGain);
        silentGain.connect(audioContext.destination);

        voiceSourceRef.current = source;
        voiceNodeRef.current = worklet;
        voiceGainRef.current = silentGain;

        setVoiceListening(true);
      };

      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          // Log every incoming WS message (truncated)
          console.log(
            "WS msg:",
            message.type || message,
            message.text || message.message || message,
          );

          if (message.type === "ready") {
            // Gnani STT connection is ready, start listening
            setVoiceListening(true);
            setIsConnecting(false);
          }

          if (message.type === "transcript" && message.text?.trim()) {
            setVoiceTranscript(message.text);
            stopVoiceListening();
            processVoiceCommand(message.text);
          }

          if (message.type === "error") {
            setFormError(message.message || "Speech recognition failed.");
            stopVoiceListening();
          }
        } catch {
          console.error("Invalid Gnani response");
        }
      };

      socket.onerror = () => {
        setFormError(
          "Could not connect to Gnani. Check your API key and backend.",
        );
        stopVoiceListening();
      };

      socket.onclose = () => {
        setVoiceListening(false);
      };
    } catch (error) {
      stopVoiceListening();
      setFormError(error.message || "Could not start microphone.");
    }
  };

  // ----------------------------------
  // Helpers
  // ----------------------------------

  const getCustomerId = (customer) => {
    return customer?.id || customer?._id;
  };

  const loadCustomers = async (search = searchTerm) => {
    try {
      const data = await api.getCustomers(search || undefined);
      setCustomers(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error("Failed to load customers:", error);
      setFormError(error.message || "Failed to load customers");
    }
  };

  const loadDashboard = async () => {
    try {
      const data = await api.getDashboardSummary();
      setDashboard(data);
    } catch (error) {
      console.error("Failed to load dashboard:", error);
    }
  };

  const loadEnhancedDashboard = async () => {
    try {
      if (typeof api.getEnhancedDashboard !== "function") return;

      const data = await api.getEnhancedDashboard();
      setEnhancedDashboard(data);
    } catch (error) {
      console.error("Enhanced dashboard unavailable:", error);
    }
  };

  const loadCustomerInsights = async () => {
    try {
      if (typeof api.getCustomerInsights !== "function") return;

      const data = await api.getCustomerInsights();
      setCustomerInsights(data?.rankedCustomers || []);
    } catch (error) {
      console.error("Customer insights unavailable:", error);
    }
  };

  const refreshData = async () => {
    await Promise.all([
      loadCustomers(),
      loadDashboard(),
      loadEnhancedDashboard(),
      loadCustomerInsights(),
    ]);
  };

  // ----------------------------------
  // Effects
  // ----------------------------------

  useEffect(() => {
    localStorage.setItem("bolkhata-view", view);
  }, [view]);

  // Initial dashboard and insights loading
  useEffect(() => {
    let active = true;

    const initializeDashboard = async () => {
      try {
        const results = await Promise.allSettled([
          api.getDashboardSummary(),
          typeof api.getEnhancedDashboard === "function"
            ? api.getEnhancedDashboard()
            : Promise.resolve(null),
          typeof api.getCustomerInsights === "function"
            ? api.getCustomerInsights()
            : Promise.resolve(null),
        ]);

        if (!active) return;

        if (results[0].status === "fulfilled") {
          setDashboard(results[0].value);
        } else {
          console.error("Dashboard loading failed:", results[0].reason);
        }

        if (results[1].status === "fulfilled" && results[1].value) {
          setEnhancedDashboard(results[1].value);
        } else if (results[1].status === "rejected") {
          console.error(
            "Enhanced dashboard loading failed:",
            results[1].reason,
          );
        }

        if (results[2].status === "fulfilled" && results[2].value) {
          setCustomerInsights(results[2].value.rankedCustomers || []);
        } else if (results[2].status === "rejected") {
          console.error("Customer insights loading failed:", results[2].reason);
        }
      } catch (error) {
        console.error("Initial loading failed:", error);
      }
    };

    initializeDashboard();

    return () => {
      active = false;
    };
  }, []);

  // Search customers whenever the search term changes
  useEffect(() => {
    let active = true;

    const loadSearchResults = async () => {
      try {
        const data = await api.getCustomers(searchTerm || undefined);

        if (active) {
          setCustomers(Array.isArray(data) ? data : []);
        }
      } catch (error) {
        if (active) {
          console.error("Customer search failed:", error);
        }
      }
    };

    loadSearchResults();

    return () => {
      active = false;
    };
  }, [searchTerm]);

  // Load transactions for selected customer
  useEffect(() => {
    if (!selectedCustomer) return;

    let active = true;

    const loadTransactions = async () => {
      try {
        const data = await api.getCustomerTransactions(
          getCustomerId(selectedCustomer),
        );

        if (active) {
          setTransactions(Array.isArray(data) ? data : []);
        }
      } catch (error) {
        if (active) {
          console.error("Failed to load customer transactions:", error);
        }
      }
    };

    loadTransactions();

    return () => {
      active = false;
    };
  }, [selectedCustomer]);

  // ----------------------------------
  // Dashboard calculations
  // ----------------------------------

  const totalCustomers = dashboard?.totalCustomers ?? customers.length;

  const todayCredit = dashboard?.todayCredit ?? 0;
  const todayPayment = dashboard?.todayPayment ?? 0;

  const totalOutstanding =
    dashboard?.totalOutstanding ??
    customers.reduce((sum, customer) => {
      return sum + Number(customer.outstanding || 0);
    }, 0);

  const topCustomers = enhancedDashboard?.topCustomers || [];

  const recentTransactions = enhancedDashboard?.recentTransactions || [];

  // ----------------------------------
  // Navigation
  // ----------------------------------

  const goToDashboard = () => {
    setView("dashboard");
    setFormError(null);
  };

  const goToCustomers = () => {
    setView("customers");
    setFormError(null);
  };

  const goToCustomerDetail = (customer) => {
    setSelectedCustomer(customer);
    setModalData(null);
    setView("customer-detail");
  };

  // ----------------------------------
  // Customer modal
  // ----------------------------------

  const closeModal = () => {
    setOpenModal(null);
    setModalData(null);
    setFormError(null);
  };

  const openAddCustomer = () => {
    setFormError(null);

    setModalData({
      name: "",
      phone: "",
      reminderOptIn: false,
    });

    setOpenModal("add-customer");
  };

  const openEditCustomer = (customer) => {
    setFormError(null);

    setModalData({
      name: customer.name || "",
      phone: customer.phone || "",
      reminderOptIn: Boolean(customer.reminderOptIn),
    });

    setSelectedCustomer(customer);
    setOpenModal("edit-customer");
  };

  const handleModalInputChange = (event) => {
    const { name, value, type, checked } = event.target;

    setModalData((previous) => ({
      ...previous,
      [name]: type === "checkbox" ? checked : value,
    }));
  };

  const handleModalSubmit = async (event) => {
    event.preventDefault();

    setFormError(null);
    setSuccessMessage(null);

    if (!modalData?.name?.trim()) {
      setFormError("Customer name is required");
      return;
    }

    try {
      setLoading(true);

      if (openModal === "add-customer") {
        await api.createCustomer(
          modalData.name.trim(),
          modalData.phone,
          modalData.reminderOptIn,
        );

        closeModal();
        setSuccessMessage("Customer added successfully");
      } else if (openModal === "edit-customer") {
        if (!selectedCustomer) {
          throw new Error("No customer selected");
        }

        await api.updateCustomer(
          getCustomerId(selectedCustomer),
          modalData.name.trim(),
          modalData.phone,
          modalData.reminderOptIn,
        );

        closeModal();
        setSuccessMessage("Customer updated successfully");
      }

      await refreshData();
    } catch (error) {
      setFormError(error.message || "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  // ----------------------------------
  // Manual transaction
  // ----------------------------------

  const openAddTransaction = () => {
    setFormError(null);

    setModalData({
      customerId: selectedCustomer ? getCustomerId(selectedCustomer) : "",
      type: "CREDIT",
      amount: "",
      description: "",
    });

    setView("add-transaction");
  };

  const addTransaction = async (event) => {
    event.preventDefault();

    setFormError(null);
    setSuccessMessage(null);

    const amount = Number(modalData?.amount);

    if (
      !modalData?.customerId ||
      !modalData?.type ||
      !Number.isFinite(amount) ||
      amount < 1
    ) {
      setFormError("Please fill in all required fields");
      return;
    }

    try {
      setLoading(true);

      await api.createTransaction(
        modalData.customerId,
        modalData.type,
        amount,
        modalData.description || "",
        "MANUAL",
      );

      setModalData(null);
      setSuccessMessage("Transaction added successfully");

      await refreshData();

      if (selectedCustomer) {
        const data = await api.getCustomerTransactions(
          getCustomerId(selectedCustomer),
        );

        setTransactions(Array.isArray(data) ? data : []);
      }

      setView(selectedCustomer ? "customer-detail" : "dashboard");
    } catch (error) {
      setFormError(error.message || "Failed to add transaction");
    } finally {
      setLoading(false);
    }
  };

  // ----------------------------------
  // Customer deletion
  // ----------------------------------

  const deleteCustomer = async (customer) => {
    const confirmed = window.confirm(
      `Are you sure you want to delete ${customer.name}?`,
    );

    if (!confirmed) return;

    try {
      await api.deleteCustomer(getCustomerId(customer));

      await refreshData();

      setSuccessMessage("Customer deleted successfully");
    } catch (error) {
      setFormError(error.message || "Failed to delete customer");
    }
  };

  // ----------------------------------
  // Demo voice command processing
  // ----------------------------------

  const processVoiceCommand = (command) => {
    if (!command?.trim()) {
      setFormError("Please enter a command");
      return;
    }

    // Map Devanagari words to the Latin words the parser understands.
    // Customer names must be lowercase to match customer.name.toLowerCase().
    // Add every customer you plan to use in the demo.
    const wordMap = {
      "रमेश": "ramesh",
      "सुरेश": "suresh",
      "को": "ko",
      "ने": "ne",
      "का": "ka",
      "की": "ka",
      "के": "ka",
      "उधार": "udhaar",
      "उधारी": "udhaar",
      "दिया": "diya",
      "दिए": "diye",
      "दिये": "diye",
      "दे": "de",
      "रुपये": "rupaye",
      "रुपए": "rupaye",
      "रुपया": "rupaye",
      "मिला": "mila",
      "मिले": "mila",
      "कितना": "kitna",
      "कितनी": "kitna",
      "बैलेंस": "balance",
      "बैलेन्स": "balance",
      "बाकी": "baaki",
      "है": "hai",
      "हैं": "hai",
      "आज": "aaj",
      "पेमेंट": "payment",
      "पेमेन्ट": "payment",
    };

    const numberWords = {
      "एक": 1, "दो": 2, "तीन": 3, "चार": 4, "पांच": 5, "पाँच": 5,
      "छह": 6, "छः": 6, "सात": 7, "आठ": 8, "नौ": 9, "दस": 10,
      "बीस": 20, "तीस": 30, "चालीस": 40, "पचास": 50,
      "साठ": 60, "सत्तर": 70, "अस्सी": 80, "नब्बे": 90,
    };
    const multipliers = { "सौ": 100, "हजार": 1000, "हज़ार": 1000 };

    const tokens = command
      .replace(/(\d),(?=\d)/g, "$1") // 1,000 -> 1000
      .replace(/[₹,]/g, " ")
      .replace(/[०-९]/g, (d) => "०१२३४५६७८९".indexOf(d))
      .split(/\s+/)
      .filter(Boolean);

    const out = [];
    for (const word of tokens) {
      if (multipliers[word]) {
        const prev = out[out.length - 1];
        if (/^\d+$/.test(prev ?? "")) {
          out[out.length - 1] = String(Number(prev) * multipliers[word]);
        } else {
          out.push(String(multipliers[word]));
        }
      } else if (numberWords[word] !== undefined) {
        out.push(String(numberWords[word]));
      } else {
        out.push(wordMap[word] ?? word);
      }
    }

    const normalizedCommand = out.join(" ").toLowerCase().trim();

    console.log("normalized:", normalizedCommand);

    setFormError(null);
    setVoiceConfirmation(null);

    // Today's payment summary
    if (
      normalizedCommand.includes("aaj kitna payment mila") ||
      normalizedCommand.includes("aaj kitna payment aaya")
    ) {
      speakText(`Aaj ${todayPayment} rupaye payment mila.`);
      return;
    }

    // Today's credit summary
    if (
      normalizedCommand.includes("aaj kitna udhaar diya") ||
      normalizedCommand.includes("aaj kitna credit")
    ) {
      speakText(`Aaj ${todayCredit} rupaye udhaar diya gaya.`);
      return;
    }

    // Find customer by actual name
    const matchedCustomer = customers.find((customer) => {
      const name = customer.name?.toLowerCase();
      return name && normalizedCommand.includes(name);
    });

    // Customer balance query
    const isBalanceQuery =
      normalizedCommand.includes("balance") ||
      normalizedCommand.includes("baaki") ||
      normalizedCommand.includes("remaining");

    if (isBalanceQuery) {
      if (!matchedCustomer) {
        setFormError("Customer not found. Please check the customer name.");
        return;
      }

      speakText(
        `${matchedCustomer.name} ka balance ${matchedCustomer.outstanding} rupaye hai.`,
      );

      return;
    }

    // Extract transaction amount
    const amountMatch = normalizedCommand.match(
      /(?:₹\s*)?(\d+(?:\.\d+)?)\s*(?:rupaye|rupees|rs)?/i,
    );

    if (!amountMatch || !matchedCustomer) {
      setFormError(
        "Command samajh nahi aaya. Example: Ramesh ko 500 rupaye udhaar diya.",
      );
      return;
    }

    const amount = Number(amountMatch[1]);

    if (!Number.isFinite(amount) || amount < 1) {
      setFormError("Please provide a valid amount");
      return;
    }

    // Detect payment or credit
    const isPayment =
      /\bne\b/i.test(normalizedCommand) ||
      normalizedCommand.includes("de diye") ||
      normalizedCommand.includes("payment mila") ||
      normalizedCommand.includes("jama kiya") ||
      normalizedCommand.includes("paid");

    const type = isPayment ? "PAYMENT" : "CREDIT";

    // Show confirmation. Nothing is saved yet.
    setVoiceConfirmation({
      type,
      amount,
      customer: matchedCustomer.name,

      onConfirm: async () => {
        try {
          setLoading(true);

          await api.createTransaction(
            getCustomerId(matchedCustomer),
            type,
            amount,
            `${type === "CREDIT" ? "Udhar diya" : "Payment received"} - ${command}`,
            "VOICE",
              true,
          );

          setVoiceConfirmation(null);
          setVoiceTranscript("");

          await refreshData();

          speakText(`${amount} rupaye successfully save ho gaye.`);
        } catch (error) {
          setFormError(error.message || "Transaction could not be saved");
        } finally {
          setLoading(false);
        }
      },

      onCancel: () => {
        setVoiceConfirmation(null);
        setFormError(null);
      },
    });

    // Spoken confirmation prompt
    speakText(
      `${matchedCustomer.name} ko ${amount} rupaye ${type === "CREDIT" ? "udhaar diya" : "payment mila"}. Kya main save kar doon?`,
    );
  };

  // ----------------------------------
  // Filter customers
  // ----------------------------------

  const filteredCustomers = customers.filter((customer) => {
    const nameMatches = customer.name
      ?.toLowerCase()
      .includes(searchTerm.toLowerCase());

    const phoneMatches = customer.phone?.includes(searchTerm);

    return nameMatches || phoneMatches;
  });

  // ----------------------------------
  // Dashboard view
  // ----------------------------------

  const dashboardView = () => (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="bg-white rounded-xl p-6 shadow-sm">
          <div className="text-3xl font-bold text-primary navy">
            {totalCustomers}
          </div>

          <div className="text-gray-500 mt-2">Total Customers</div>

          <button
            onClick={goToCustomers}
            className="mt-3 text-primary navy text-sm hover:underline"
          >
            <Menu className="inline w-4 h-4 mr-1" />
            View All
          </button>
        </div>

        <div className="bg-white rounded-xl p-6 shadow-sm">
          <div className="text-3xl font-bold text-green-600">
            ₹{todayCredit}
          </div>

          <div className="text-gray-500 mt-2">Today's Credit</div>
        </div>

        <div className="bg-white rounded-xl p-6 shadow-sm">
          <div className="text-3xl font-bold text-green-600">
            ₹{todayPayment}
          </div>

          <div className="text-gray-500 mt-2">Today's Payments</div>
        </div>

        <div className="bg-white rounded-xl p-6 shadow-sm">
          <div className="text-3xl font-bold text-red-600">
            ₹{totalOutstanding}
          </div>

          <div className="text-gray-500 mt-2">Total Outstanding</div>
        </div>
      </div>

      <div className="bg-white rounded-xl p-6 shadow-sm">
        <h2 className="text-xl font-bold text-primary navy mb-4">
          Top Customers by Outstanding
        </h2>

        {topCustomers.length > 0 ? (
          <div className="space-y-3">
            {topCustomers.slice(0, 5).map((customer, index) => (
              <div
                key={customer.id || customer._id || index}
                className="p-3 rounded bg-gray-50 flex justify-between"
              >
                <span className="font-medium">{customer.name}</span>

                <span className="font-bold text-red-600">
                  ₹{customer.outstanding}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-gray-500 text-sm">
            No customer insights available.
          </p>
        )}
      </div>

      <div className="bg-white rounded-xl p-6 shadow-sm">
        <h2 className="text-xl font-bold text-primary navy mb-4">
          Customer Insights
        </h2>

        {customerInsights.length > 0 ? (
          <div>
            <p className="text-sm text-gray-500">Highest Outstanding</p>

            <p className="font-medium">{customerInsights[0].name}</p>

            <p className="text-red-600 font-bold">
              ₹{customerInsights[0].outstanding}
            </p>
          </div>
        ) : (
          <p className="text-gray-500 text-sm">
            No customer insights available.
          </p>
        )}

        <div className="mt-4">
          <p className="text-sm text-gray-500">Zero Balance Customers</p>

          <p className="font-medium">
            {
              customers.filter((customer) => Number(customer.outstanding) === 0)
                .length
            }
          </p>
        </div>

        <div className="mt-3">
          <p className="text-sm text-gray-500">Negative Balance Customers</p>

          <p className="font-medium">
            {
              customers.filter((customer) => Number(customer.outstanding) < 0)
                .length
            }
          </p>
        </div>
      </div>

      <div className="bg-white rounded-xl p-6 shadow-sm">
        <h2 className="text-xl font-bold text-primary navy mb-4">
          Recent Transactions
        </h2>

        {recentTransactions.length > 0 ? (
          <div className="space-y-3">
            {recentTransactions.slice(0, 10).map((transaction, index) => (
              <div
                key={transaction.id || transaction._id || index}
                className="p-3 rounded bg-gray-50 flex justify-between items-center"
              >
                <span
                  className={
                    transaction.type === "CREDIT"
                      ? "text-green-600"
                      : "text-red-600"
                  }
                >
                  {transaction.customerName || "Customer"} - {transaction.type}
                </span>

                <span className="font-bold">₹{transaction.amount}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-gray-500 text-sm">
            No recent transactions available.
          </p>
        )}
      </div>
    </div>
  );

  // ----------------------------------
  // Customers view
  // ----------------------------------

  const customersView = () => (
    <div className="bg-white rounded-xl p-6 shadow-sm">
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <input
          type="text"
          placeholder="Search by name or phone..."
          value={searchTerm}
          onChange={(event) => setSearchTerm(event.target.value)}
          className="flex-1 rounded-lg border border-gray-300 px-4 py-2"
        />

        <button
          onClick={openAddCustomer}
          className="bg-primary green text-white px-4 py-2 rounded"
        >
          <Plus className="inline w-4 h-4 mr-2" />
          Add Customer
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-table">
          <thead>
            <tr className="border-b text-left text-sm text-gray-500">
              <th className="py-3">Name</th>
              <th className="py-3">Phone</th>
              <th className="py-3">Outstanding</th>
              <th className="py-3">Actions</th>
            </tr>
          </thead>

          <tbody>
            {filteredCustomers.map((customer) => (
              <tr
                key={getCustomerId(customer)}
                className="border-b border-gray-100"
              >
                <td className="py-4 font-medium">{customer.name}</td>

                <td className="py-4 text-gray-600">{customer.phone || "-"}</td>

                <td className="py-4 font-bold text-red-600">
                  ₹{customer.outstanding}
                </td>

                <td className="py-4 space-x-3">
                  <button
                    onClick={() => goToCustomerDetail(customer)}
                    className="text-primary navy hover:underline"
                  >
                    View
                  </button>

                  <button
                    onClick={() => openEditCustomer(customer)}
                    className="text-green-600 hover:underline"
                  >
                    Edit
                  </button>

                  <button
                    onClick={() => deleteCustomer(customer)}
                    className="text-red-600 hover:underline"
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}

            {filteredCustomers.length === 0 && (
              <tr>
                <td colSpan="4" className="py-6 text-center text-gray-500">
                  No customers found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );

  // ----------------------------------
  // Customer detail view
  // ----------------------------------

  const customerDetailView = () => {
    if (!selectedCustomer) return null;

    const customerTransactions = [...transactions].sort(
      (a, b) =>
        new Date(b.transactionDate || b.date) -
        new Date(a.transactionDate || a.date),
    );

    return (
      <div className="bg-white rounded-xl p-6 md:p-8 max-w-4xl mx-auto">
        <button
          onClick={goToCustomers}
          className="text-primary navy mb-6 hover:underline"
        >
          ← Back to Customers
        </button>

        <h2 className="text-2xl font-bold text-primary navy">
          {selectedCustomer.name}
        </h2>

        <p className="text-gray-500 mb-6">
          {selectedCustomer.phone || "No phone"}
        </p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          <div className="bg-gray-50 rounded-lg p-4">
            <p className="text-xl font-bold text-red-600">
              ₹{selectedCustomer.outstanding}
            </p>
            <p className="text-sm text-gray-500">Outstanding</p>
          </div>

          <div className="bg-gray-50 rounded-lg p-4">
            <p className="text-xl font-bold text-primary navy">
              ₹{selectedCustomer.totalCredit}
            </p>
            <p className="text-sm text-gray-500">Total Credit</p>
          </div>

          <div className="bg-gray-50 rounded-lg p-4">
            <p className="text-xl font-bold text-green-600">
              ₹{selectedCustomer.totalPayment}
            </p>
            <p className="text-sm text-gray-500">Total Payment</p>
          </div>
        </div>

        <button
          onClick={openAddTransaction}
          className="bg-primary green text-white px-5 py-3 rounded mb-6"
        >
          <Plus className="inline w-4 h-4 mr-2" />
          Add Transaction
        </button>

        <h3 className="text-xl font-bold text-primary navy mb-4">
          Transaction History
        </h3>

        {customerTransactions.length > 0 ? (
          <div className="space-y-3">
            {customerTransactions.map((transaction, index) => (
              <div
                key={transaction.id || transaction._id || index}
                className="p-4 rounded bg-gray-50"
              >
                <div className="flex justify-between gap-3">
                  <span
                    className={
                      transaction.type === "CREDIT"
                        ? "font-bold text-green-600"
                        : "font-bold text-red-600"
                    }
                  >
                    {transaction.type} - ₹{transaction.amount}
                  </span>

                  <span className="text-sm text-gray-500">
                    {new Date(
                      transaction.transactionDate || transaction.date,
                    ).toLocaleDateString("en-IN")}
                  </span>
                </div>

                <p className="text-sm text-gray-500 mt-2">
                  {transaction.description || "No description"}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-gray-500">
            No transactions found for this customer.
          </p>
        )}
      </div>
    );
  };

  // ----------------------------------
  // Add transaction view
  // ----------------------------------

  const addTransactionView = () => (
    <div className="bg-white rounded-xl p-6 shadow-sm max-w-xl mx-auto">
      <h2 className="text-xl font-bold text-primary navy mb-6">
        Add New Transaction
      </h2>

      <form onSubmit={addTransaction} className="space-y-4">
        <div>
          <label className="block text-sm text-gray-600 mb-2">Customer</label>

          <select
            required
            value={modalData?.customerId || ""}
            onChange={(event) => {
              setModalData((previous) => ({
                ...previous,
                customerId: event.target.value,
              }));
            }}
            className="w-full rounded-lg border border-gray-300 px-3 py-2"
          >
            <option value="">Select Customer</option>

            {customers.map((customer) => (
              <option
                key={getCustomerId(customer)}
                value={getCustomerId(customer)}
              >
                {customer.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm text-gray-600 mb-2">
            Transaction Type
          </label>

          <select
            value={modalData?.type || "CREDIT"}
            onChange={(event) => {
              setModalData((previous) => ({
                ...previous,
                type: event.target.value,
              }));
            }}
            className="w-full rounded-lg border border-gray-300 px-3 py-2"
          >
            <option value="CREDIT">CREDIT - Udhar diya</option>
            <option value="PAYMENT">PAYMENT - Payment received</option>
          </select>
        </div>

        <div>
          <label className="block text-sm text-gray-600 mb-2">Amount (₹)</label>

          <input
            type="number"
            min="1"
            required
            value={modalData?.amount || ""}
            onChange={(event) => {
              setModalData((previous) => ({
                ...previous,
                amount: event.target.value,
              }));
            }}
            className="w-full rounded-lg border border-gray-300 px-3 py-2"
          />
        </div>

        <div>
          <label className="block text-sm text-gray-600 mb-2">
            Description
          </label>

          <input
            type="text"
            value={modalData?.description || ""}
            onChange={(event) => {
              setModalData((previous) => ({
                ...previous,
                description: event.target.value,
              }));
            }}
            placeholder="e.g. Goods purchased"
            className="w-full rounded-lg border border-gray-300 px-3 py-2"
          />
        </div>

        <div className="flex gap-3">
          <button
            type="submit"
            disabled={loading}
            className="flex-1 bg-primary green text-white py-3 rounded"
          >
            {loading ? "Saving..." : "Save Transaction"}
          </button>

          <button
            type="button"
            onClick={() => {
              setView(selectedCustomer ? "customer-detail" : "dashboard");
            }}
            className="px-5 py-3 rounded border"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );

  // ----------------------------------
  // Demo voice assistant
  // ----------------------------------

  const voiceView = () => (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl p-8 max-w-lg w-full shadow-xl">
        <div className="mb-6 bg-primary/5 border border-primary rounded-lg p-4 text-center">
          <button
            onClick={() => {
              if (voiceListening) {
                stopVoiceListening();
              } else if (!isConnecting) {
                setIsConnecting(true);
                startVoiceListening();
              }
            }}
            disabled={Boolean(isConnecting || voiceConfirmation || loading)}
            className="w-full bg-primary green text-white py-3 rounded mt-3 transition-colors"
            type="button"
          >
            {isConnecting
              ? "Connecting..."
              : voiceListening
                ? "Stop Listening"
                : "Start Listening"}
          </button>
        </div>

        <label
          htmlFor="voice-command"
          className="block text-sm text-gray-600 mb-2"
        >
          Your Command
        </label>

        <textarea
          id="voice-command"
          rows="3"
          value={voiceTranscript}
          onChange={(event) => setVoiceTranscript(event.target.value)}
          disabled={Boolean(voiceConfirmation) || loading}
          placeholder="Ramesh ko 500 rupaye udhaar diya"
          className="w-full rounded-lg border border-gray-300 p-3"
        />

        <button
          onClick={() => processVoiceCommand(voiceTranscript)}
          disabled={Boolean(voiceConfirmation) || loading}
          className="w-full bg-primary green text-white py-3 rounded mt-3"
        >
          Process Command
        </button>

        {formError && <p className="mt-4 text-sm text-red-600">{formError}</p>}

        {voiceConfirmation && (
          <div className="mt-6 p-4 rounded-lg bg-primary/5 border border-primary">
            <h3 className="font-bold text-primary navy mb-3">
              Confirm Transaction
            </h3>

            <p className="mb-2">
              Customer: <strong>{voiceConfirmation.customer}</strong>
            </p>

            <p className="mb-2">
              Type: <strong>{voiceConfirmation.type}</strong>
            </p>

            <p className="mb-4">
              Amount: <strong>₹{voiceConfirmation.amount}</strong>
            </p>

            <p className="text-sm text-gray-600 mb-4">
              Do you want to save this transaction?
            </p>

            <div className="flex gap-3">
              <button
                onClick={voiceConfirmation.onConfirm}
                disabled={loading}
                className="flex-1 bg-primary green text-white py-2 rounded"
              >
                {loading ? "Saving..." : "Confirm"}
              </button>

              <button
                onClick={voiceConfirmation.onCancel}
                disabled={loading}
                className="flex-1 bg-white border border-gray-300 py-2 rounded"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        <div className="mt-8 space-y-3">
          <p className="text-sm font-bold text-gray-500">Demo Commands</p>

          {[
            "Ramesh ko 500 rupaye udhaar diya",
            "Suresh ne 1000 rupaye de diye",
            "Ramesh ka kitna balance baaki hai?",
            "Aaj kitna payment mila?",
          ].map((command) => (
            <button
              key={command}
              onClick={() => {
                setVoiceTranscript(command);
                setFormError(null);
              }}
              className="block w-full text-left text-sm text-primary navy hover:underline"
            >
              "{command}"
            </button>
          ))}
        </div>
      </div>
    </div>
  );

  // ----------------------------------
  // Main application render
  // ----------------------------------

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-200 bg-white shadow-sm">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-4 px-6 py-4">
          <h1 className="text-xl font-bold text-primary navy">BolKhataAI</h1>

          <nav className="flex flex-wrap items-center gap-3">
            <button
              onClick={goToDashboard}
              className={
                view === "dashboard"
                  ? "bg-primary green text-white px-4 py-2 rounded"
                  : "text-gray-600 px-4 py-2 rounded"
              }
            >
              Dashboard
            </button>

            <button
              onClick={goToCustomers}
              className={
                view === "customers" || view === "customer-detail"
                  ? "bg-primary green text-white px-4 py-2 rounded"
                  : "text-gray-600 px-4 py-2 rounded"
              }
            >
              Customers
            </button>

            <button
              onClick={() => setView("voice")}
              className={
                view === "voice"
                  ? "bg-primary green text-white px-4 py-2 rounded"
                  : "text-gray-600 px-4 py-2 rounded"
              }
            >
              Voice Assistant
            </button>

            <button
              onClick={openAddCustomer}
              className="bg-primary green text-white px-4 py-2 rounded"
            >
              <Plus className="inline w-4 h-4 mr-1" />
              Add Customer
            </button>
          </nav>
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-6">
        {successMessage && (
          <div className="mb-4 p-3 bg-green-50 text-green-700 rounded">
            {successMessage}

            <button
              onClick={() => setSuccessMessage(null)}
              className="float-right"
            >
              ×
            </button>
          </div>
        )}

        {formError && view !== "voice" && (
          <div className="mb-4 p-3 bg-red-50 text-red-700 rounded">
            {formError}

            <button onClick={() => setFormError(null)} className="float-right">
              ×
            </button>
          </div>
        )}

        {view === "dashboard" && dashboardView()}

        {view === "customers" && customersView()}

        {view === "customer-detail" && customerDetailView()}

        {view === "add-transaction" && addTransactionView()}

        {view === "voice" && voiceView()}
      </main>

      {/* Add/Edit Customer Modal */}

      {openModal && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl p-6 w-full max-w-md shadow-xl">
            <h2 className="text-xl font-bold text-primary navy mb-5">
              {openModal === "add-customer" ? "Add Customer" : "Edit Customer"}
            </h2>

            <form onSubmit={handleModalSubmit} className="space-y-4">
              <div>
                <label className="block text-sm text-gray-600 mb-1">
                  Customer Name
                </label>

                <input
                  name="name"
                  required
                  value={modalData?.name || ""}
                  onChange={handleModalInputChange}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2"
                  placeholder="Enter customer name"
                />
              </div>

              <div>
                <label className="block text-sm text-gray-600 mb-1">
                  Phone Number
                </label>

                <input
                  name="phone"
                  value={modalData?.phone || ""}
                  onChange={handleModalInputChange}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2"
                  placeholder="Enter phone number"
                />
              </div>

              <label className="flex items-center gap-2 text-sm text-gray-600">
                <input
                  type="checkbox"
                  name="reminderOptIn"
                  checked={Boolean(modalData?.reminderOptIn)}
                  onChange={handleModalInputChange}
                />
                Enable payment reminders
              </label>

              {formError && <p className="text-sm text-red-600">{formError}</p>}

              <div className="flex gap-3 pt-2">
                <button
                  type="submit"
                  disabled={loading}
                  className="flex-1 bg-primary green text-white py-2 rounded"
                >
                  {loading ? "Saving..." : "Save"}
                </button>

                <button
                  type="button"
                  onClick={closeModal}
                  className="flex-1 border border-gray-300 py-2 rounded"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;