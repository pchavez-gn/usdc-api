# **USDC Indexer & API**

This project is an API that tracks recent **USDC token transfers** on the Ethereum mainnet. It uses a Dockerized setup with two services: `usdc_db` and `usdc_app`. The `usdc_db` service is a PostgreSQL database that stores the transfer data, while the `usdc_app` service is the backend application. When the application starts, it automatically fetches the latest 1000 transfers and saves them to the database. It then exposes API endpoints that allow users to query this data, providing a convenient way to access and analyze recent transfer history.

---

## **1. Setup Instructions**

### **Prerequisites**

Before you begin, make sure you have the following installed:

- [Docker](https://www.docker.com/products/docker-desktop)  
- [Docker Compose](https://docs.docker.com/compose/install/)

### **Step-by-Step Guide**

1. **Create the environment file**  
   In the project root, create a file named `.env.docker` with the following content:

   ```bash
   DATABASE_URL=postgresql://usdc:usdc@usdc_db:5432/usdc_indexer
   ETH_RPC_URL=https://mainnet.infura.io/v3/<YOUR_API_KEY>
   USDC_CONTRACT=0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48
   MAX_BLOCKS=3
   MAX_INDEXER_SIZE=1000
   ```

   > **Note:** Replace `<YOUR_API_KEY>` with your valid Infura API key.

2. **Start the application**  
   Build and launch the containers with:

   ```bash
   docker-compose up --build
   ```

   This will:
   - Build the `usdc_app` Docker image  
   - Start the `usdc_db` and `usdc_app` containers  
   - Run the API server at [http://localhost:3000](http://localhost:3000)

3. **Access the API**  
   Once running, the API is available at:

   - Base URL: [http://localhost:3000](http://localhost:3000)  
   - Interactive docs: [http://localhost:3000/api](http://localhost:3000/api)

---

## **2. API Documentation**

### Get Recent Transfers
- **Endpoint:** `GET /transfers`  
- **Description:** Returns a list of recent USDC transfers.  
- **Query Parameters:**  
  - `from` (optional) – filter by sender address  
  - `to` (optional) – filter by recipient address  
  - `limit` (optional, default: 20) – number of transfers to return  

---

### Get Address Balance
- **Endpoint:** `GET /transfers/balance/:address`  
- **Description:** Fetches the **real-time USDC balance** of a given Ethereum address using blockchain RPC.  
- **Path Parameter:**  
  - `address` (required) – Ethereum address to query  

---

### Get Transfer History
- **Endpoint:** `GET /transfers/history/:address`  
- **Description:** Returns transfers where the given address was either sender or recipient.  
- **Path Parameter:**  
  - `address` (required) – Ethereum address  
- **Query Parameter:**  
  - `limit` (optional, default: 20) – number of transfers to return  

---

### Simulate a Transfer (Demo)
- **Endpoint:** `POST /transfers/transfer`  
- **Description:** Demonstrates how a USDC transfer transaction is constructed.  
  *This does **not** broadcast to the blockchain.*  
- **Request Body:**  
  - `fromPk` (required) – sender’s private key  
  - `to` (required) – recipient Ethereum address  
  - `amount` (required) – amount of USDC to transfer (e.g., `"100.5"`)  

---

## **3. Fault Tolerance & Data Integrity**

- The indexer service starts retrieving from the most recent block backward. It retrieves blocks in chunks until one of two conditions is met: either it has found and processed at least 1000 transfer events, or it encounters a block that has already been indexed in the database. After fetching the new transfers, it removes the oldest ones from the database, keeping only the latest 1000 transfers, ensuring that interruptions never create gaps in the data.  

- New records are written before older ones are pruned, keeping the database consistent while respecting the configured index size.  

---
