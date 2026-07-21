// lib/paystack/plans.js
//
// Mirrors src/lib/plans.ts on the frontend. Deliberately duplicated —
// prices here are what gets checked against server-side, never trusted
// from the client, from Paystack's metadata, or from anything else the
// caller sends.

export const PLAN_PRICES = {
  mini:       { name: 'Mini',       price: 199,  car_limit: 1 },
  individual: { name: 'Individual', price: 499,  car_limit: 1 },
  duo:        { name: 'Duo',        price: 999,  car_limit: 2 },
  family:     { name: 'Family',     price: 1999, car_limit: 5 },
}
