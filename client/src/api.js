/* ========================================
   BOLKHATAI - API SERVICE LAYER
   ======================================== */

// ----------------------------------------
// API Endpoints
// ----------------------------------------

export const ENDPOINTS = {
  CUSTOMERS: '/api/customers',
  CUSTOMER: (id) => `/api/customers/${id}`,

  TRANSACTIONS: '/api/transactions',
  TRANSACTION: (id) => `/api/transactions/${id}`,

  TRANSACTION_SUMMARY: '/api/transactions/summary',
  TRANSACTION_CUSTOMER: (id) => `/api/transactions/customer/${id}`,

  DASHBOARD_ENHANCED: '/api/customers/dashboard/enhanced',
  CUSTOMERS_INSIGHTS: '/api/customers/insights',
}

// ----------------------------------------
// Data Type Definitions
// ----------------------------------------

/**
 * @typedef {Object} Customer
 * @property {string} id
 * @property {string} name
 * @property {string|null} phone
 * @property {number} totalCredit
 * @property {number} totalPayment
 * @property {number} outstanding
 * @property {boolean} reminderOptIn
 * @property {string} createdAt
 */

export const Customer = {
  id: '',
  name: '',
  phone: null,
  totalCredit: 0,
  totalPayment: 0,
  outstanding: 0,
  reminderOptIn: false,
  createdAt: '',
}

/**
 * @typedef {Object} Transaction
 * @property {string} id
 * @property {'CREDIT'|'PAYMENT'} type
 * @property {number} amount
 * @property {string} description
 * @property {'VOICE'|'MANUAL'} source
 * @property {string} transactionDate
 * @property {string} createdAt
 */

export const Transaction = {
  id: '',
  type: 'CREDIT',
  amount: 0,
  description: '',
  source: 'MANUAL',
  transactionDate: '',
  createdAt: '',
}

/**
 * @typedef {Object} DashboardSummary
 * @property {number} totalCustomers
 * @property {number} todayCredit
 * @property {number} todayPayment
 * @property {number} totalOutstanding
 */

export const DashboardSummary = {
  totalCustomers: 0,
  todayCredit: 0,
  todayPayment: 0,
  totalOutstanding: 0,
}

/**
 * @typedef {Object} EnhancedDashboard
 * @property {Object} dashboard
 * @property {Array} topCustomers
 * @property {Array} recentTransactions
 */

export const EnhancedDashboard = {
  dashboard: {
    totalCustomers: 0,
    todayCredit: 0,
    todayPayment: 0,
    totalOutstanding: 0,
  },
  topCustomers: [],
  recentTransactions: [],
}

/**
 * @typedef {Object} CustomerInsights
 * @property {Array<Object>} rankedCustomers
 * @property {number} totalCustomers
 */

export const CustomerInsights = {
  rankedCustomers: [],
  totalCustomers: 0,
}

// ----------------------------------------
// API Configuration
// ----------------------------------------

const API_BASE_URL = (
  import.meta.env.VITE_API_URL || 'http://localhost:5000'
).replace(/\/+$/, '')

// ----------------------------------------
// API Service Class
// ----------------------------------------

class APIService {
  constructor() {
    this.token = null
  }

  /**
   * Set authentication token.
   * @param {string|null} token
   */
  setAuthToken(token) {
    this.token = token
  }

  /**
   * Centralized API request handler.
   * @param {string} endpoint
   * @param {RequestInit} [options]
   * @returns {Promise<any>}
   */
  async request(endpoint, options = {}) {
    const url = `${API_BASE_URL}${endpoint}`

    const headers = {
      Accept: 'application/json',
      ...(options.headers || {}),
    }

    if (options.body && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json'
    }

    if (this.token) {
      headers.Authorization = `Bearer ${this.token}`
    }

    let response

    try {
      response = await fetch(url, {
        ...options,
        headers,
      })
    } catch (error) {
      console.error('API connection failed:', error)

      const err = new Error(
        `Cannot connect to backend at ${API_BASE_URL}. Make sure your backend server is running.`
      )
      err.cause = error
      throw err
    }

    // Handle empty responses
    if (response.status === 204) {
      return null
    }

    // Parse response safely
    const contentType = response.headers.get('content-type') || ''

    let data

    try {
      if (contentType.includes('application/json')) {
        data = await response.json()
      } else {
        data = await response.text()
      }
    } catch {
      data = null
    }

    // Handle unsuccessful responses
    if (!response.ok) {
      const message =
        typeof data === 'object' && data !== null
          ? data.message || data.error
          : data

      if (response.status === 401) {
        throw new Error(message || 'Unauthorized. Please log in again.')
      }

      if (response.status === 403) {
        throw new Error(message || 'You do not have permission.')
      }

      if (response.status === 404) {
        throw new Error(message || 'API endpoint or resource not found.')
      }

      if (response.status === 422) {
        throw new Error(message || 'Validation error.')
      }

      if (response.status === 429) {
        throw new Error('Rate limit exceeded. Please try again later.')
      }

      if (response.status >= 500) {
        throw new Error(message || 'Server error. Please try again later.')
      }

      throw new Error(
        message || `Request failed with status ${response.status}`
      )
    }

    return data
  }

  // ----------------------------------------
  // Customer Methods
  // ----------------------------------------

  /**
   * Get all customers.
   * @param {string} [searchTerm]
   * @returns {Promise<Customer[]>}
   */
  async getCustomers(searchTerm) {
    let endpoint = ENDPOINTS.CUSTOMERS

    if (searchTerm) {
      endpoint += `?search=${encodeURIComponent(searchTerm)}`
    }

    const data = await this.request(endpoint)
    return Array.isArray(data) ? data : data.customers
  }

  /**
   * Get customer by ID.
   * @param {string} id
   * @returns {Promise<Customer>}
   */
  async getCustomer(id) {
    return this.request(ENDPOINTS.CUSTOMER(id))
  }

  /**
   * Create customer.
   * @param {string} name
   * @param {string} [phone]
   * @param {boolean} [reminderOptIn]
   * @returns {Promise<Customer>}
   */
  async createCustomer(name, phone, reminderOptIn) {
    return this.request(ENDPOINTS.CUSTOMERS, {
      method: 'POST',
      body: JSON.stringify({
        name,
        phone,
        reminderOptIn,
      }),
    })
  }

  /**
   * Update customer.
   * @param {string} id
   * @param {string} name
   * @param {string} [phone]
   * @param {boolean} [reminderOptIn]
   * @returns {Promise<Customer>}
   */
  async updateCustomer(id, name, phone, reminderOptIn) {
    return this.request(ENDPOINTS.CUSTOMER(id), {
      method: 'PUT',
      body: JSON.stringify({
        name,
        phone,
        reminderOptIn,
      }),
    })
  }

  /**
   * Delete customer.
   * @param {string} id
   */
  async deleteCustomer(id) {
    return this.request(ENDPOINTS.CUSTOMER(id), {
      method: 'DELETE',
    })
  }

  // ----------------------------------------
  // Transaction Methods
  // ----------------------------------------

  /**
   * Get all transactions.
   * @returns {Promise<Transaction[]>}
   */
  async getTransactions() {
    return this.request(ENDPOINTS.TRANSACTIONS)
  }

  /**
   * Get transactions for a customer.
   * @param {string} customerId
   * @returns {Promise<Transaction[]>}
   */
  async getCustomerTransactions(customerId) {
    return this.request(
      ENDPOINTS.TRANSACTION_CUSTOMER(customerId)
    )
  }

  /**
   * Create transaction.
   * @param {string} customerId
   * @param {'CREDIT'|'PAYMENT'} type
   * @param {number} amount
   * @param {string} description
   * @param {'VOICE'|'MANUAL'} [source]
   * @param {string} [transactionDate]
   * @returns {Promise<Transaction>}
   */
  async createTransaction(
    customerId,
    type,
    amount,
    description,
    source = 'MANUAL',
    confirmed = false,
    transactionDate
  ) {
    return this.request(ENDPOINTS.TRANSACTIONS, {
      method: 'POST',
      body: JSON.stringify({
        customerId,
        type,
        amount,
        description,
        source,
        confirmed,
        ...(transactionDate ? { transactionDate } : {}),
      }),
    })
  }

  /**
   * Update transaction.
   * @param {string} id
   * @param {Object} updates
   * @returns {Promise<Transaction>}
   */
  async updateTransaction(id, updates) {
    return this.request(ENDPOINTS.TRANSACTION(id), {
      method: 'PATCH',
      body: JSON.stringify(updates),
    })
  }

  /**
   * Delete transaction.
   * @param {string} id
   */
  async deleteTransaction(id) {
    return this.request(ENDPOINTS.TRANSACTION(id), {
      method: 'DELETE',
    })
  }

  // ----------------------------------------
  // Dashboard Methods
  // ----------------------------------------

  /**
   * Get dashboard summary.
   * @returns {Promise<DashboardSummary>}
   */
  async getDashboardSummary() {
    return this.request(ENDPOINTS.TRANSACTION_SUMMARY)
  }

  /**
   * Get enhanced dashboard data.
   * @returns {Promise<EnhancedDashboard>}
   */
  async getEnhancedDashboard() {
    return this.request(ENDPOINTS.DASHBOARD_ENHANCED)
  }

  /**
   * Get customer insights.
   * @returns {Promise<CustomerInsights>}
   */
  async getCustomerInsights() {
    return this.request(ENDPOINTS.CUSTOMERS_INSIGHTS)
  }

  /**
   * Generate speech from text using Gnani TTS.
   * @param {string} text
   * @returns {Promise<Blob>}
   */
  async speak(text) {
    const response = await fetch(`${API_BASE_URL}/api/voice/speak`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text }),
    })

    if (!response.ok) {
      let message = "Voice response failed.";
      try {
        const data = await response.json();
        message = data.message || message;
      } catch {}
      throw new Error(message)
    }

    return response.blob();
  }
}

// ----------------------------------------
// Export API Singleton
// ----------------------------------------

export const api = new APIService()

export default APIService