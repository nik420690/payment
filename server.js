const express = require("express");
const bodyParser = require("body-parser");
const { MongoClient, ObjectId } = require("mongodb");
const swaggerUi = require("swagger-ui-express");
const YAML = require("yamljs");
const cors = require('cors');
const env = require("dotenv").config();
const axios = require('axios');
const jwt = require('jsonwebtoken');
const amqp = require('amqplib/callback_api');
const util = require('util');
const { v4: uuidv4 } = require('uuid');

const app = express();

app.use(bodyParser.json());
app.use(cors());

// RabbitMQ connection details
const rabbitUser = "student";
const rabbitPassword = "student123";
const rabbitHost = "studentdocker.informatika.uni-mb.si";
const rabbitPort = "5672";
const vhost = "";
const amqpUrl = util.format("amqp://%s:%s@%s:%s/%s", rabbitUser, rabbitPassword, rabbitHost, rabbitPort, vhost);

// RabbitMQ Exchange, Queue, and Routing key
const exchange = 'upp-3';
const queue = 'upp-3';
const routingKey = 'zelovarnikey';

// MongoDB details
const uri = "mongodb+srv://nikkljucevsek:OldbtLLbshDbB69v@cluster0.9uuzozi.mongodb.net/";
const dbName = "paymentDB";
const collectionName = "payments";

let collection;

const jwtAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: 'Missing Authorization header' });
    }
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.SECRET_KEY);
    req.user = decoded;
    next();
  } catch (err) {
    console.error('Error verifying token:', err.message);
    return res.status(403).json({ error: 'Invalid token' });
  }
};

async function sendStatistics(data) {
  try {
    const response = await axios.post('https://statistics-jeb4.onrender.com/add-statistic', data);
    console.log(response.data);
  } catch (error) {
    console.error(`Error sending statistics: ${error.message}`);
  }
}


// Your function for logging to RabbitMQ
function logMessageToRabbitMQ(correlationId, message, logType, url, applicationName) {
  amqp.connect(amqpUrl, function(error0, connection) {
    if (error0) {
      console.error("Error connecting to RabbitMQ:", error0);
      return;  // Exit from this function
    }

    connection.createChannel(function(error1, channel) {
      if (error1) {
        console.error("Error creating channel:", error1);
        connection.close();
        return;  // Exit from this function
      }

      const msg = `${new Date().toISOString()} ${logType} ${url} Correlation: ${correlationId} [${applicationName}] - ${message}`;

      channel.assertExchange(exchange, 'direct', {
        durable: true
      });

      channel.publish(exchange, '', Buffer.from(msg));
      console.log(" [x] Sent %s", msg);

      setTimeout(() => { 
        connection.close(); 
      }, 500);
    });
  });
}


MongoClient.connect(uri, { useUnifiedTopology: true })
  .then((client) => {
    console.log("Connected to MongoDB");
    const db = client.db(dbName);
    collection = db.collection(collectionName);

    const swaggerDocument = YAML.load("./swagger.yaml");
    app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerDocument));
    
    
// Get all payments
app.get("/payments", jwtAuth, async (req, res) => {
  const correlationId = uuidv4();
  logMessageToRabbitMQ(correlationId, "Received a request to get all payments", "INFO", "/payments", "payment-service");

  sendStatistics({
    service: 'payment-service',
    endpoint: '/payments',
    method: 'POST',
    timestamp: new Date()
  });
  
  try {
    const payments = await collection.find({}).toArray();
    if (payments) {
      logMessageToRabbitMQ(correlationId, "Got all payments successfully", "INFO", "/payments", "payment-service");
      res.status(200).json(payments);
    } else {
      logMessageToRabbitMQ(correlationId, "No payments found", "WARN", "/payments", "payment-service");
      res.status(404).json({ error: "No payments found" });
    }
  } catch (error) {
    logMessageToRabbitMQ(correlationId, `Error when getting all payments: ${error.message}`, "ERROR", "/payments", "payment-service");
    console.error("Error when getting all payments:", error);
    res.status(500).json({ error: "Failed to get all payments" });
  }
});
// Create a payment
app.post("/payments", jwtAuth, async (req, res) => {
  const correlationId = uuidv4();  // generate a correlation ID

  sendStatistics({
    service: 'payment-service',
    endpoint: '/payments',
    method: 'POST',
    timestamp: new Date()
  });

  const { user_id, type, details, amount, currency, payment_status } = req.body;
  try {
    // Log the incoming request
    logMessageToRabbitMQ(correlationId, "Received a request to create a payment", "INFO", "/payments", "payment-service");

    // Make an HTTP request to get the users data
    const usersResponse = await axios.get("https://user-xojp.onrender.com/users/");
    const usersData = usersResponse.data;
    const userExists = usersData.some((user) => user.id === user_id);

    if (!userExists) {
      logMessageToRabbitMQ(correlationId, "User not found", "WARN", "/payments", "payment-service");
      return res.status(404).json({ error: "User not found" });
    }

    const payment = { user_id, type, details, amount, currency, payment_status };
    const result = await collection.insertOne(payment);

    // Log the successful operation
    logMessageToRabbitMQ(correlationId, "Payment inserted successfully", "INFO", "/payments", "payment-service");

    res.status(201).json({ message: "Payment inserted successfully", payment });
  } catch (error) {
    console.error("Error when creating payment:", error);
    
    // Log the error
    logMessageToRabbitMQ(correlationId, `Error when creating payment: ${error.message}`, "ERROR", "/payments", "payment-service");
    
    res.status(500).json({ error: "Error when creating payment", details: error.message });
  }
});

    // Get a payment by ID
app.get("/payments/:id", jwtAuth, async (req, res) => {
  const correlationId = uuidv4();
  logMessageToRabbitMQ(correlationId, "Received a request to get a payment", "INFO", "/payments/:id", "payment-service");

  sendStatistics({
    service: 'payment-service',
    endpoint: '/payments/:id',
    method: 'POST',
    timestamp: new Date()
  });
  
  const paymentId = new ObjectId(req.params.id);
  try {
    const payment = await collection.findOne({ _id: paymentId });
    if (payment) {
      logMessageToRabbitMQ(correlationId, "Got payment successfully", "INFO", "/payments/:id", "payment-service");
      res.json(payment);
    } else {
      logMessageToRabbitMQ(correlationId, "Payment not found", "WARN", "/payments/:id", "payment-service");
      res.status(404).json({ error: "Payment not found" });
    }
  } catch (error) {
    logMessageToRabbitMQ(correlationId, `Error when getting payment: ${error.message}`, "ERROR", "/payments/:id", "payment-service");
    console.error("Error when getting payment:", error);
    res.status(500).json({ error: "Failed to get payment" });
  }
});

 // Update a payment by ID
app.put("/payments/:id", jwtAuth, async (req, res) => {
  const correlationId = uuidv4();
  logMessageToRabbitMQ(correlationId, "Received a request to update a payment", "INFO", "/payments/:id", "payment-service");

  sendStatistics({
    service: 'payment-service',
    endpoint: '/payments/:id',
    method: 'POST',
    timestamp: new Date()
  });

  const paymentId = new ObjectId(req.params.id);
  const { user_id, type, details, amount, currency, payment_status } = req.body;

  try {
    const usersResponse = await axios.get("https://user-xojp.onrender.com/users/");
    const usersData = usersResponse.data;
    const userExists = usersData.some((user) => user.id === user_id);

    if (!userExists) {
      logMessageToRabbitMQ(correlationId, "User not found", "WARN", "/payments/:id", "payment-service");
      return res.status(404).json({ error: "User not found" });
    }

    const updatedPayment = { user_id, type, details, amount, currency, payment_status };
    const result = await collection.findOneAndUpdate(
      { _id: paymentId },
      { $set: updatedPayment },
      { returnOriginal: false }
    );

    if (result.value) {
      logMessageToRabbitMQ(correlationId, "Payment updated successfully", "INFO", "/payments/:id", "payment-service");
      res.json(result.value);
    } else {
      logMessageToRabbitMQ(correlationId, "Payment not found", "WARN", "/payments/:id", "payment-service");
      res.status(404).json({ error: "Payment not found" });
    }
  } catch (error) {
    logMessageToRabbitMQ(correlationId, `Error when updating payment: ${error.message}`, "ERROR", "/payments/:id", "payment-service");
    console.error("Error when updating payment:", error);
    res.status(500).json({ error: "Failed to update payment" });
  }
});

// Delete a payment by ID
app.delete("/payments/:id", jwtAuth, async (req, res) => {
  const correlationId = uuidv4();
  logMessageToRabbitMQ(correlationId, "Received a request to delete a payment", "INFO", "/payments/:id", "payment-service");

  sendStatistics({
    service: 'payment-service',
    endpoint: '/payments/:id',
    method: 'POST',
    timestamp: new Date()
  });

  const paymentId = new ObjectId(req.params.id);

  try {
    const result = await collection.findOneAndDelete({ _id: paymentId });

    if (result.value) {
      logMessageToRabbitMQ(correlationId, "Payment deleted successfully", "INFO", "/payments/:id", "payment-service");
      res.json({ message: "Payment deleted successfully" });
    } else {
      logMessageToRabbitMQ(correlationId, "Payment not found", "WARN", "/payments/:id", "payment-service");
      res.status(404).json({ error: "Payment not found" });
    }
  } catch (error) {
    logMessageToRabbitMQ(correlationId, `Error when deleting payment: ${error.message}`, "ERROR", "/payments/:id", "payment-service");
    console.error("Error when deleting payment:", error);
    res.status(500).json({ error: "Failed to delete payment" });
  }
});

// Delete all payments
app.delete("/payments", jwtAuth, async (req, res) => {
  const correlationId = uuidv4();
  logMessageToRabbitMQ(correlationId, "Received a request to delete all payments", "INFO", "/payments", "payment-service");

  sendStatistics({
    service: 'payment-service',
    endpoint: '/payments/:id',
    method: 'POST',
    timestamp: new Date()
  });

  try {
    await collection.deleteMany({});
    logMessageToRabbitMQ(correlationId, "All payments deleted successfully", "INFO", "/payments", "payment-service");
    res.json({ message: "All payments deleted successfully" });
  } catch (error) {
    logMessageToRabbitMQ(correlationId, `Error when deleting all payments: ${error.message}`, "ERROR", "/payments", "payment-service");
    console.error("Error when deleting all payments:", error);
    res.status(500).json({ error: "Failed to delete all payments" });
  }
});

app.get("/payments/user/:userId", jwtAuth, async (req, res) => {
  const userId = req.params.userId;
  const correlationId = uuidv4(); // Generate a correlation ID for the request

  logMessageToRabbitMQ(correlationId, `Received a request to get payment data for user: ${userId}`, "INFO", `/payments/user/${userId}`, "payment-service");

  sendStatistics({
    service: 'payment-service',
    endpoint: `/payments/user/${userId}`,
    method: 'GET',
    timestamp: new Date()
  });

  try {
    // Check if user exists in user service
    const usersResponse = await axios.get("https://user-xojp.onrender.com/users/");
    const usersData = usersResponse.data;
    const userExists = usersData.some((user) => user.id === userId);

    if (!userExists) {
      logMessageToRabbitMQ(correlationId, "User not found", "WARN", `/payments/user/${userId}`, "payment-service");
      return res.status(404).json({ error: "User not found" });
    }

    const payment = await collection.findOne({ user_id: userId });

    if (payment) {
      logMessageToRabbitMQ(correlationId, `Payment data found for user: ${userId}`, "INFO", `/payments/user/${userId}`, "payment-service");
      res.json(payment);
    } else {
      logMessageToRabbitMQ(correlationId, `Payment not found for user: ${userId}`, "WARN", `/payments/user/${userId}`, "payment-service");
      res.status(404).json({ error: "Payment not found for the given user" });
    }
  } catch (error) {
    logMessageToRabbitMQ(correlationId, `Error when getting payment by user: ${error.message}`, "ERROR", `/payments/user/${userId}`, "payment-service");
    console.error("Error when getting payment by user:", error);
    res.status(500).json({ error: "Failed to get payment" });
  }
});

app.put("/payments/user/:userId", jwtAuth, async (req, res) => {
    const userId = req.params.userId; 
    const correlationId = uuidv4(); // Generate a correlation ID for the request
    const { type, details, amount, currency, payment_status } = req.body;
  
    logMessageToRabbitMQ(correlationId, `Received a request to update payment data for user: ${userId}`, "INFO", `/payments/user/${userId}`, "payment-service");
  
    sendStatistics({
      service: 'payment-service',
      endpoint: `/payments/user/${userId}`,
      method: 'PUT',
      timestamp: new Date()
    });
  
    try {
      // Check if user exists in user service
      const usersResponse = await axios.get("https://user-xojp.onrender.com/users/");
      const usersData = usersResponse.data;
      const userExists = usersData.some((user) => user.id === userId);
  
      if (!userExists) {
        logMessageToRabbitMQ(correlationId, "User not found", "WARN", `/payments/user/${userId}`, "payment-service");
        return res.status(404).json({ error: "User not found" });
      }
  
      const payment = await collection.findOne({ user_id: userId });
  
      if (!payment) {
        logMessageToRabbitMQ(correlationId, "Payment not found for user", "WARN", `/payments/user/${userId}`, "payment-service");
        return res.status(404).json({ error: "Payment not found for the given user" });
      }
  
      const updatedPayment = { user_id: userId, type, details, amount, currency, payment_status };
      const result = await collection.findOneAndUpdate(
        { user_id: userId },
        { $set: updatedPayment },
        { returnOriginal: false }
      );
  
      if (result.value) {
        logMessageToRabbitMQ(correlationId, "Payment updated successfully", "INFO", `/payments/user/${userId}`, "payment-service");
        res.json(result.value);
      } else {
        logMessageToRabbitMQ(correlationId, "Payment update failed", "WARN", `/payments/user/${userId}`, "payment-service");
        res.status(500).json({ error: "Payment update failed" });
      }
    } catch (error) {
      logMessageToRabbitMQ(correlationId, `Error when updating payment: ${error.message}`, "ERROR", `/payments/user/${userId}`, "payment-service");
      console.error("Error when updating payment:", error);
      res.status(500).json({ error: "Failed to update payment" });
    }
  });
  




    // Start the server
    const port = 3088;
    app.listen(port, () => {
      console.log(`Server is running on port ${port}`);
    });
  })
  .catch((error) => {
    console.error("Error connecting to MongoDB:", error);
  });