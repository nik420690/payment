const chai = require("chai");
const chaiHttp = require("chai-http");
const should = chai.should();

chai.use(chaiHttp);

describe("Payments API", () => {

  // Test for GET /payments
  it("should GET all payments", (done) => {
    chai.request(server)
      .get("/payments")
      .set('Authorization', 'Bearer ' + token)
      .end((err, res) => {
        res.should.have.status(200);
        res.body.should.be.a('array');
        done();
      });
  });

  // Test for POST /payments
  it("should POST a payment", (done) => {
    let payment = {
      user_id: "<some-id>",
      type: "credit",
      details: "test details",
      amount: 50,
      currency: "USD",
      payment_status: "pending"
    };

    chai.request(server)
      .post("/payments")
      .set('Authorization', 'Bearer ' + token)
      .send(payment)
      .end((err, res) => {
        res.should.have.status(201);
        res.body.should.be.a('object');
        res.body.should.have.property('message').eql('Payment inserted successfully');
        done();
      });
  });

  // Test for GET /payments/:id
  it("should GET a payment by the given id", (done) => {
    const paymentId = "<some-valid-id>";
    chai.request(server)
      .get("/payments/" + paymentId)
      .set('Authorization', 'Bearer ' + token)
      .end((err, res) => {
        res.should.have.status(200);
        res.body.should.be.a('object');
        done();
      });
  });

  // Test for PUT /payments/:id
  it("should UPDATE a payment by the given id", (done) => {
    const paymentId = "<some-valid-id>";
    let payment = {
      user_id: "<some-id>",
      type: "debit",
      details: "updated details",
      amount: 100,
      currency: "USD",
      payment_status: "completed"
    };

    chai.request(server)
      .put("/payments/" + paymentId)
      .set('Authorization', 'Bearer ' + token)
      .send(payment)
      .end((err, res) => {
        res.should.have.status(200);
        res.body.should.be.a('object');
        done();
      });
  });

  // Test for DELETE /payments/:id
  it("should DELETE a payment by the given id", (done) => {
    const paymentId = "<some-valid-id>";
    chai.request(server)
      .delete("/payments/" + paymentId)
      .set('Authorization', 'Bearer ' + token)
      .end((err, res) => {
        res.should.have.status(200);
        res.body.should.be.a('object');
        res.body.should.have.property('message').eql('Payment deleted successfully');
        done();
      });
  });

  // Test for DELETE /payments
  it("should DELETE all payments", (done) => {
    chai.request(server)
      .delete("/payments")
      .set('Authorization', 'Bearer ' + token)
      .end((err, res) => {
        res.should.have.status(200);
        res.body.should.be.a('object');
        res.body.should.have.property('message').eql('All payments deleted successfully');
        done();
      });
  });
});
