'use strict';

const { Kafka } = require('kafkajs');

const kafka = new Kafka({
  clientId: 'arch-test-gen',
  brokers:  (process.env.KAFKA_BROKERS || 'localhost:9092').split(','),
});

const producer = kafka.producer();
const consumer = kafka.consumer({ groupId: 'arch-test-gen' });

module.exports = { producer, consumer };
