/* eslint-disable no-console */

"use strict";

let { times, random, padStart } = require("lodash");

let chalk = require("chalk");
let ServiceBroker = require("../../src/service-broker");
const humanize 			= require("tiny-human-time").short;

let transporter = process.env.TRANSPORTER || "TCP";

let sumTime = 0;
let maxTime = null;

// Create broker
let broker = new ServiceBroker({
	namespace: "loadtest",
	nodeID: process.argv[2] || "client",
	transporter,
	logger: console,
	logLevel: "warn",
	//metrics: true,
	requestTimeout: 10000,
	retryCount: 3,
});

console.log("Client started. nodeID:", broker.nodeID, " TRANSPORTER:", transporter, " PID:", process.pid);
/*
function work() {
	let payload = { a: random(0, 100), b: random(0, 100) };
	const p = broker.call("math.add", payload)
		.then(() => broker._callCount++)
		.catch(err => console.warn(err.message));
		//.then(() => setImmediate(work));

	//* Overload
	if (broker.transit.pendingRequests.size < 2 * 1000)
		setImmediate(work);
	else
		p.then(() => setImmediate(work));

}
*/
let counter = 0;
let errorCount = 0;

const flood = process.env.FLOOD || 0;

function work() {
	const startTime = process.hrtime();
	let payload = { c: ++counter };
	const p = broker.call("perf.reply", payload)
		.then(() => {
			broker._callCount++;

			const diff = process.hrtime(startTime);
			const dur = (diff[0] + diff[1] / 1e9) * 1000;
			sumTime += dur;
			if (maxTime == null || maxTime < dur)
				maxTime = dur;
		})
		.catch(err => {
			console.warn(err.message, " Counter:", payload.c);
			errorCount++;
		});

	// Overload
	if (flood > 0 && broker.transit.pendingRequests.size < flood)
		setImmediate(work);
	else
		p.then(() => setImmediate(work));
}

broker._callCount = 0;

function color(text, pad, value, green, red) {
	let c;
	if (value <= green)
		c = chalk.green.bold;
	else if (value >= red)
		c = chalk.red.bold;
	else
		c = chalk.yellow.bold;
	return c(padStart(text, pad));
}

broker.start()
	.then(() => broker.waitForServices("perf"))
	.then(() => {
		setTimeout(() => {
			let startTime = Date.now();
			work();

			setInterval(() => {
				if (broker._callCount > 0) {
					let rps = broker._callCount / ((Date.now() - startTime) / 1000);

					let queueSize = broker.transit.pendingRequests.size;
					let latency = sumTime/broker._callCount;

					console.log(broker.nodeID, ":",
						padStart(Number(rps.toFixed(0)).toLocaleString(), 8), "req/s",
						"  Q:", color(Number(queueSize.toFixed(0)).toLocaleString(), 5, queueSize, 100, flood ? flood*.8 : 100),
						"  E:", color(Number(errorCount.toFixed(0)).toLocaleString(), 5, errorCount, 0, 1),
						"  L:", color(humanize(latency), 6, latency, 500, 5000),
						"  ML:", color(humanize(maxTime), 6, maxTime, 1000, 5000)
					);
					broker._callCount = 0;
					sumTime = 0;
					maxTime = 0;
					startTime = Date.now();
				}
			}, 1000);

		}, 1000);
	});
