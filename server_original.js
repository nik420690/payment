const express = require("express");
const bodyParser = require("body-parser");
const { MongoClient, ObjectId } = require("mongodb");
const swaggerUi = require("swagger-ui-express");
const YAML = require("yamljs");
const cors = require('cors');
const env = require("dotenv").config();
const util = require('util');
const amqp = require('amqplib/callback_api');
const axios = require('axios');
const authorize = require('./middleware/authorization');

// Ustvarimo Express aplikacijo
const app = express();

// Dodamo middleware za razčlenjevanje JSON-a in omogočanje CORS
app.use(bodyParser.json());
app.use(cors());

// MongoDB connection string
const uri = "mongodb+srv://nikkljucevsek:OldbtLLbshDbB69v@cluster0.9uuzozi.mongodb.net/";

// Database and collection names
const dbName = "paymentDB";
const collectionName = "payments";

// RabbitMQ connection details
const rabbitUser = "student";
const rabbitPassword = "student123";
const rabbitHost = "rabbit";
const rabbitPort = "5672";
const vhost = "";
const amqpUrl = util.format("amqp://%s:%s@%s:%s/%s", rabbitUser, rabbitPassword, rabbitHost, rabbitPort, vhost);

// RabbitMQ Exchange, Queue, and Routing key
const exchange = 'upp-3';
const queue = 'upp-3';
const routingKey = 'zelovarnikey';

// Funkcija za objavo dnevnika v RabbitMQ
function publishLog(log) {
    amqp.connect(amqpUrl, { heartbeat: 60 }, (error, connection) => {
        if (error) {
            console.error("Error connecting to RabbitMQ:", error);
            return;
        }
        connection.createChannel((error, channel) => {
            if (error) {
                console.error("Error creating RabbitMQ channel:", error);
                return;
            }
            // Ustvari izmenjavo in čakalno vrsto ter ju poveži
            channel.assertExchange(exchange, 'direct', { durable: true });
            channel.assertQueue(queue, { durable: true });
            channel.bindQueue(queue, exchange, routingKey);
            // Objavi dnevnik
            channel.publish(exchange, routingKey, Buffer.from(log));
            // Počakaj in zapri povezavo
            setTimeout(() => {
                channel.close();
                connection.close();
            }, 500);
        });
    });
}

// Connect to MongoDB
MongoClient.connect(uri, { useUnifiedTopology: true })
    .then((client) => {
        console.log("Connected to MongoDB");
        const db = client.db(dbName);
        const collection = db.collection(collectionName);

        // Swagger setup
        const swaggerDocument = YAML.load("./swagger.yaml");
        app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerDocument));

// Ustvari novo plačilo
app.post("/payments", authorize, (req, res) => {
    // Iz telesa zahteve pridobimo podatke o plačilu
    const { user_id, type, details, amount, currency, payment_status } = req.body;

    // Ustvarimo objekt za plačilo
    const payment = { user_id, type, details, amount, currency, payment_status };

    // Pridobimo ali ustvarimo vrednost correlationId iz glav zahteve
    const correlationId = req.headers["x-correlation-id"] || new ObjectId().toString();

    // Vstavimo objekt plačila v zbirko podatkov
    collection
        .insertOne(payment)
        .then((result) => {
            console.log("Vstavljeno plačilo:");

            // Objavimo dnevnik v RabbitMQ s podatki o uspešno ustvarjenem plačilu
            const log = `${new Date().toISOString()} INFO http://localhost:3044/payments CorrelationId: ${correlationId} [payment-service] - Uspešno ustvarjeno plačilo.`;
            publishLog(log);

            // Pretvorimo rezultat v niz in ga pošljemo kot odgovor
            var resultString = JSON.stringify(result);
            res.status(201).json(resultString);

            // Pošljemo zahtevo za statistiko na Heroku aplikacijo
            axios
                .post(
                    "https://statistics-service-api.herokuapp.com/add-statistic",
                    { service: "Payment", endpoint: "create" }
                )
                .then(() => {
                    console.log("Statistika uspešno poslana.");
                })
                .catch((error) => {
                    console.error("Napaka pri pošiljanju statistike:", error);
                });
        })
        .catch((error) => {
            // Objavimo dnevnik o napaki v RabbitMQ
            const log = `${new Date().toISOString()} ERROR http://localhost:3044/payments CorrelationId: ${correlationId} [payment-service] - Napaka pri ustvarjanju plačila.`;
            publishLog(log);

            console.error("Napaka pri ustvarjanju plačila:", error);
            res.status(500).json({ error: "Napaka pri ustvarjanju plačila" });
        });
});

// Pridobi vsa plačila
app.get("/payments", authorize, (req, res) => {
    // Pridobimo ali ustvarimo vrednost correlationId iz glav zahteve
    const correlationId = req.headers["x-correlation-id"] || new ObjectId().toString();

    // Poiščemo vsa plačila v zbirki podatkov
    collection.find({})
        .toArray()
        .then((payments) => {
            // Objavimo dnevnik v RabbitMQ s podatki o uspešno pridobljenih plačilih
            const log = `${new Date().toISOString()} INFO http://localhost:3044/payments CorrelationId: ${correlationId} [payment-service] - Uspešno pridobljena vsa plačila.`;
            publishLog(log);

            // Pošljemo zahtevo za statistiko na Heroku aplikacijo
            axios.post("https://statistics-service-api.herokuapp.com/add-statistic", {service: "Payment", endpoint: "getAll"})
                .then(() => console.log("Statistika uspešno poslana."))
                .catch((error) => console.error("Napaka pri pošiljanju statistike:", error));

            // Pošljemo odgovor s seznamom plačil
            res.json(payments);
        })
        .catch((error) => {
            // Objavimo dnevnik o napaki v RabbitMQ
            const log = `${new Date().toISOString()} ERROR http://localhost:3044/payments CorrelationId: ${correlationId} [payment-service] - Napaka pri pridobivanju plačil.`;
            publishLog(log);

            console.error("Napaka pri pridobivanju plačil:", error);
            res.status(500).json({error: "Napaka pri pridobivanju plačil"});
        });
});


// Pridobi plačila glede na ID uporabnika
app.get("/payments/user/:user_id", authorize, (req, res) => {
    // Iz parametrov zahteve pridobimo ID uporabnika
    const { user_id } = req.params;

    // Pridobimo ali ustvarimo vrednost correlationId iz glav zahteve
    const correlationId = req.headers["x-correlation-id"] || new ObjectId().toString();

    // Poiščemo plačila, kjer se ujema user_id
    collection
        .find({ user_id })
        .toArray()
        .then((payments) => {
            // Preverimo, če so bila najdena katera plačila
            if (payments.length > 0) {
                // Objavimo dnevnik v RabbitMQ o uspešno pridobljenih plačilih
                const log = `${new Date().toISOString()} INFO http://localhost:3044/payments/user/${user_id} CorrelationId: ${correlationId} [payment-service] - Uspešno pridobljena plačila za user_id: ${user_id}.`;
                publishLog(log);

                // Pošljemo odgovor s seznamom plačil
                res.json(payments);

                // Pošljemo zahtevo za statistiko na Heroku aplikacijo
                axios
                    .post(
                        "https://statistics-service-api.herokuapp.com/add-statistic",
                        { service: "Payment", endpoint: "getByUserId" }
                    )
                    .then(() => {
                        console.log("Statistika uspešno poslana.");
                    })
                    .catch((error) => {
                        console.error("Napaka pri pošiljanju statistike:", error);
                    });
            } else {
                // Objavimo dnevnik, da ni bilo najdenih plačil za ta user_id
                const log = `${new Date().toISOString()} INFO http://localhost:3044/payments/user/${user_id} CorrelationId: ${correlationId} [payment-service] - Ni plačil za user_id: ${user_id}.`;
                publishLog(log);

                res.status(404).json({ error: "Ni plačil za uporabnika" });
            }
        })
        .catch((error) => {
            // Objavimo dnevnik o napaki pri pridobivanju plačil
            const log = `${new Date().toISOString()} ERROR http://localhost:3044/payments/user/${user_id} CorrelationId: ${correlationId} [payment-service] - Napaka pri pridobivanju plačil za user_id: ${user_id}.`;
            publishLog(log);

            console.error("Napaka pri pridobivanju plačil:", error);
            res.status(500).json({ error: "Napaka pri pridobivanju plačil" });
        });
});

// Pridobi plačila glede na tip
app.get("/payments/type/:type", authorize, (req, res) => {
    // Iz parametrov zahteve pridobimo tip
    const { type } = req.params;

    // Pridobimo ali ustvarimo vrednost correlationId iz glav zahteve
    const correlationId = req.headers["x-correlation-id"] || new ObjectId().toString();

    // Poiščemo plačila, kjer se ujema tip
    collection
        .find({ type })
        .toArray()
        .then((payments) => {
            // Preverimo, če so bila najdena katera plačila
            if (payments.length > 0) {
                // Objavimo dnevnik v RabbitMQ o uspešno pridobljenih plačilih
                const log = `${new Date().toISOString()} INFO http://localhost:3044/payments/type/${type} CorrelationId: ${correlationId} [payment-service] - Uspešno pridobljena plačila za tip: ${type}.`;
                publishLog(log);

                // Pošljemo odgovor s seznamom plačil
                res.json(payments);

                // Pošljemo zahtevo za statistiko na Heroku aplikacijo
                axios
                    .post(
                        "https://statistics-service-api.herokuapp.com/add-statistic",
                        { service: "Payment", endpoint: "getByType" }
                    )
                    .then(() => {
                        console.log("Statistika uspešno poslana.");
                    })
                    .catch((error) => {
                        console.error("Napaka pri pošiljanju statistike:", error);
                    });
            } else {
                // Objavimo dnevnik, da ni bilo najdenih plačil za ta tip
                const log = `${new Date().toISOString()} INFO http://localhost:3044/payments/type/${type} CorrelationId: ${correlationId} [payment-service] - Ni plačil za tip: ${type}.`;
                publishLog(log);

                res.status(404).json({ error: "Ni plačil za ta tip" });
            }
        })
        .catch((error) => {
            // Objavimo dnevnik o napaki pri pridobivanju plačil
            const log = `${new Date().toISOString()} ERROR http://localhost:3044/payments/type/${type} CorrelationId: ${correlationId} [payment-service] - Napaka pri pridobivanju plačil za tip: ${type}.`;
            publishLog(log);

            console.error("Napaka pri pridobivanju plačil:", error);
            res.status(500).json({ error: "Napaka pri pridobivanju plačil" });
        });
});


// Pridobi plačilo glede na ID
app.get("/payments/:id", authorize, (req, res) => {
    // Ustvarimo ObjectId s pomočjo ID-ja plačila iz parametrov zahteve
    const paymentId = new ObjectId(req.params.id);

    // Pridobimo ali ustvarimo vrednost correlationId iz glav zahteve
    const correlationId = req.headers["x-correlation-id"] || new ObjectId().toString();

    // Poiščemo plačilo z ujemajočim se ID-jem
    collection
        .findOne({ _id: paymentId })
        .then((payment) => {
            // Preverimo, če je bilo plačilo najdeno
            if (payment) {
                // Objavimo dnevnik v RabbitMQ o uspešno pridobljenem plačilu
                const log = `${new Date().toISOString()} INFO http://localhost:3044/payments/${paymentId} CorrelationId: ${correlationId} [payment-service] - Uspešno pridobljeno plačilo z ID-jem: ${paymentId}.`;
                publishLog(log);

                // Pošljemo odgovor s podatki o plačilu
                res.json(payment);

                // Pošljemo zahtevo za statistiko na Heroku aplikacijo
                axios
                    .post(
                        "https://statistics-service-api.herokuapp.com/add-statistic",
                        { service: "Payment", endpoint: "getById" }
                    )
                    .then(() => {
                        console.log("Statistika uspešno poslana.");
                    })
                    .catch((error) => {
                        console.error("Napaka pri pošiljanju statistike:", error);
                    });
            } else {
                // Objavimo dnevnik, da plačilo ni bilo najdeno
                const log = `${new Date().toISOString()} INFO http://localhost:3044/payments/${paymentId} CorrelationId: ${correlationId} [payment-service] - Plačilo ni bilo najdeno z ID-jem: ${paymentId}.`;
                publishLog(log);

                res.status(404).json({ error: "Plačilo ni bilo najdeno" });
            }
        })
        .catch((error) => {
            // Objavimo dnevnik o napaki pri pridobivanju plačila
            const log = `${new Date().toISOString()} ERROR http://localhost:3044/payments/${paymentId} CorrelationId: ${correlationId} [payment-service] - Napaka pri pridobivanju plačila z ID-jem: ${paymentId}.`;
            publishLog(log);

            console.error("Napaka pri pridobivanju plačila:", error);
            res.status(500).json({ error: "Napaka pri pridobivanju plačila" });
        });
});

// Posodobi plačilo glede na ID
app.put("/payments/:id", authorize, (req, res) => {
    // Ustvarimo ObjectId s pomočjo ID-ja plačila iz parametrov zahteve
    const paymentId = new ObjectId(req.params.id);

    // Iz telesa zahteve pridobimo podatke, ki jih želimo posodobiti
    const { user_id, type, details, amount, currency, payment_status } = req.body;
    const updatedPayment = { user_id, type, details, amount, currency, payment_status };

    // Pridobimo ali ustvarimo vrednost correlationId iz glav zahteve
    const correlationId = req.headers["x-correlation-id"] || new ObjectId().toString();

    // Posodobimo plačilo v bazi
    collection
        .findOneAndUpdate(
            { _id: paymentId },
            { $set: updatedPayment },
            { returnOriginal: false }
        )
        .then((result) => {
            // Preverimo, če je bilo plačilo uspešno posodobljeno
            if (result.value) {
                // Objavimo dnevnik v RabbitMQ o uspešno posodobljenem plačilu
                const log = `${new Date().toISOString()} INFO http://localhost:3044/payments/${paymentId} CorrelationId: ${correlationId} [payment-service] - Uspešno posodobljeno plačilo z ID-jem: ${paymentId}.`;
                publishLog(log);

                // Pošljemo odgovor s posodobljenimi podatki o plačilu
                res.json(result.value);

                // Pošljemo zahtevo za statistiko na Heroku aplikacijo
                axios
                    .post(
                        "https://statistics-service-api.herokuapp.com/add-statistic",
                        { service: "Payment", endpoint: "updateById" }
                    )
                    .then(() => {
                        console.log("Statistika uspešno poslana.");
                    })
                    .catch((error) => {
                        console.error("Napaka pri pošiljanju statistike:", error);
                    });
            } else {
                // Objavimo dnevnik, da plačilo ni bilo najdeno
                const log = `${new Date().toISOString()} INFO http://localhost:3044/payments/${paymentId} CorrelationId: ${correlationId} [payment-service] - Plačilo ni bilo najdeno z ID-jem: ${paymentId}.`;
                publishLog(log);

                res.status(404).json({ error: "Plačilo ni bilo najdeno" });
            }
        })
        .catch((error) => {
            // Objavimo dnevnik o napaki pri posodabljanju plačila
            const log = `${new Date().toISOString()} ERROR http://localhost:3044/payments/${paymentId} CorrelationId: ${correlationId} [payment-service] - Napaka pri posodabljanju plačila z ID-jem: ${paymentId}.`;
            publishLog(log);

            console.error("Napaka pri posodabljanju plačila:", error);
            res.status(500).json({ error: "Napaka pri posodabljanju plačila" });
        });
});




// Delete payment by ID
app.delete("/payments/:id", authorize, (req, res) => {
    // Pridobi ID plačila iz URL parametra
    const paymentId = new ObjectId(req.params.id);
    // Pridobi ali ustvari vrednost correlationId iz glav zahteve
    const correlationId = req.headers["x-correlation-id"] || new ObjectId().toString();

    // Izbriši plačilo z določenim ID-jem iz zbirke podatkov
    collection
        .findOneAndDelete({ _id: paymentId })
        .then((result) => {
            // Preveri, če je bilo plačilo uspešno izbrisano
            if (result.value) {
                // Objavi dnevnik v RabbitMQ o uspešno izbrisani plačilu
                const log = `${new Date().toISOString()} INFO http://localhost:3044/payments/${paymentId} CorrelationId: ${correlationId} [payment-service] - Uspešno izbrisano plačilo z ID-jem: ${paymentId}.`;
                publishLog(log);

                // Pošlje odgovor, da je bilo plačilo uspešno izbrisano
                res.json({ message: "Plačilo uspešno izbrisano" });

                // Pošlje statistiko na Heroku aplikacijo
                axios
                    .post(
                        "https://statistics-service-api.herokuapp.com/add-statistic",
                        { service: "Payment", endpoint: "deleteById" }
                    )
                    .then(() => {
                        console.log("Statistika uspešno poslana.");
                    })
                    .catch((error) => {
                        console.error("Napaka pri pošiljanju statistike:", error);
                    });
            } else {
                // Objavi dnevnik, da plačilo ni bilo najdeno
                const log = `${new Date().toISOString()} INFO http://localhost:3044/payments/${paymentId} CorrelationId: ${correlationId} [payment-service] - Plačilo ni bilo najdeno z ID-jem: ${paymentId}.`;
                publishLog(log);

                // Pošlje odgovor, da plačilo ni bilo najdeno
                res.status(404).json({ error: "Plačilo ni bilo najdeno" });
            }
        })
        .catch((error) => {
            // Objavi dnevnik o napaki pri brisanju plačila
            const log = `${new Date().toISOString()} ERROR http://localhost:3044/payments/${paymentId} CorrelationId: ${correlationId} [payment-service] - Napaka pri brisanju plačila z ID-jem: ${paymentId}.`;
            publishLog(log);

            // Pošlje odgovor, da je prišlo do napake pri brisanju
            console.error("Napaka pri brisanju plačila:", error);
            res.status(500).json({ error: "Napaka pri brisanju plačila" });
        });
});

// Delete all payments
app.delete("/payments", authorize, (req, res) => {
    // Pridobi ali ustvari vrednost correlationId iz glav zahteve
    const correlationId = req.headers["x-correlation-id"] || new ObjectId().toString();

    // Izbriši vsa plačila v zbirki podatkov
    collection.deleteMany({})
        .then((result) => {
            // Objavi dnevnik v RabbitMQ o uspešno izbrisanih vseh plačilih
            const log = `${new Date().toISOString()} INFO http://localhost:3044/payments CorrelationId: ${correlationId} [payment-service] - Uspešno izbrisana vsa plačila.`;
            publishLog(log);

            // Pošlje odgovor, da so bila vsa plačila uspešno izbrisana
            res.json({ message: "Vsa plačila uspešno izbrisana" });

            // Pošlje statistiko na Heroku aplikacijo
            axios
                .post(
                    "https://statistics-service-api.herokuapp.com/add-statistic",
                    { service: "Payment", endpoint: "deleteAll" }
                )
                .then(() => {
                    console.log("Statistika uspešno poslana.");
                })
                .catch((error) => {
                    console.error("Napaka pri pošiljanju statistike:", error);
                });
        })
        .catch((error) => {
            // Objavi dnevnik o napaki pri brisanju vseh plačil
            const log = `${new Date().toISOString()} ERROR http://localhost:3044/payments CorrelationId: ${correlationId} [payment-service] - Napaka pri brisanju vseh plačil.`;
            publishLog(log);

            // Pošlje odgovor, da je prišlo do napake pri brisanju
            console.error("Napaka pri brisanju plačil:", error);
            res.status(500).json({ error: "Napaka pri brisanju plačil" });
        });
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










