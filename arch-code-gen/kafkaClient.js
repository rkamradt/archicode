'use strict';

const { Kafka } = require('kafkajs');

const kafka = new Kafka({
  clientId: 'arch-code-gen',
  brokers:  (process.env.KAFKA_BROKERS || 'localhost:9092').split(','),
});

const producer = kafka.producer();
const consumer = kafka.consumer({ groupId: 'arch-code-gen' });

module.exports = { producer, consumer };
