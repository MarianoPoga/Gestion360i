import { db, isSupabaseConfigured } from './src/supabaseClient.js';

console.log("Checking database orders...");
console.log("Is Supabase configured?", isSupabaseConfigured());

try {
  const orders = await db.getPedidos();
  if (orders && orders.length > 0) {
    console.log("Number of orders found:", orders.length);
    const firstOrder = orders[0];
    console.log("First order keys:", Object.keys(firstOrder));
    console.log("First order details:", {
      id: firstOrder.id,
      estado: firstOrder.estado,
      cae: firstOrder.cae,
      factura_nro: firstOrder.factura_nro,
      factura_error: firstOrder.factura_error
    });
  } else {
    console.log("No orders found in the database.");
  }
} catch (error) {
  console.error("Error fetching orders:", error);
}
