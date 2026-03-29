// ============================================================
// Red Pack API Module
// Placeholder — fill in BASE_URL and API_KEY when available
// ============================================================

const RedPackAPI = {

  BASE_URL: 'https://api.rpiraq.com/api',
  API_KEY: 't9g8cynsjyy4bgn2ndu65iw0',

  // Fetch order details by barcode number
  async getOrderByBarcode(barcodeId) {
    if (!this.API_KEY) {
      console.warn('[RedPackAPI] API key not configured. Returning null.');
      return null;
    }

    try {
      const response = await fetch(`${this.BASE_URL}/scan?barcode=${encodeURIComponent(barcodeId)}`, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'api-access-key': this.API_KEY
        }
      });

      if (!response.ok) {
        console.warn(`[RedPackAPI] Order not found for barcode: ${barcodeId}`);
        return null;
      }

      const result = await response.json();
      if (!result.status || !result.data?.order) return null;

      const order = result.data.order;
      return {
        barcode: String(order.id || barcodeId),
        driverName: order.driver?.name?.trim() || '',
        receiverPhone: order.receiver?.phone || '',
        price: order.price ?? 0,
        quantity: order.quantity ?? 1,
        clientName: order.client?.name || '',
        clientPhone: order.client?.user_phone || '',
        address: [order.info?.address?.name, order.info?.additional_location].filter(Boolean).join(' — '),
        note: order.info?.note || '',
      };
    } catch (err) {
      console.error('[RedPackAPI] Request failed:', err);
      return null;
    }
  }
};
