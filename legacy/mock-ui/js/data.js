/* ShopMint demo — seed data for all tenants.
 * App.data.seed(tenantId) returns a fresh, fully populated tenant state object.
 * Generation is deterministic per tenant (seeded RNG); dates are relative to "now"
 * so the last-90-days views are always populated. */
window.App = window.App || {};
(function (A) {
  'use strict';
  var DAY = 864e5;

  function rng(seed) {
    var s = seed >>> 0;
    return function () { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  }

  var CITIES = [
    ['Mumbai', 'Maharashtra', '400050', '302, Sai Krupa CHS, Linking Road, Bandra West'],
    ['Pune', 'Maharashtra', '411004', 'A-12, Prabhat Road, Erandwane'],
    ['Nagpur', 'Maharashtra', '440010', '18, Dharampeth Extension'],
    ['New Delhi', 'Delhi', '110016', 'B-14, Green Park Extension'],
    ['Gurugram', 'Haryana', '122002', 'Tower 5, Flat 1102, DLF Phase 4'],
    ['Bengaluru', 'Karnataka', '560095', '12, 4th Cross, Koramangala 5th Block'],
    ['Chennai', 'Tamil Nadu', '600018', '7, Kasturi Rangan Road, Alwarpet'],
    ['Coimbatore', 'Tamil Nadu', '641018', '22, Race Course Road'],
    ['Hyderabad', 'Telangana', '500033', 'Plot 45, Road No. 10, Jubilee Hills'],
    ['Kolkata', 'West Bengal', '700019', '9A, Ballygunge Place'],
    ['Ahmedabad', 'Gujarat', '380015', '14, Satellite Road, Jodhpur Char Rasta'],
    ['Surat', 'Gujarat', '395001', '301, Ghod Dod Road'],
    ['Jaipur', 'Rajasthan', '302017', 'C-27, Malviya Nagar'],
    ['Lucknow', 'Uttar Pradesh', '226010', '5/112, Vikas Khand, Gomti Nagar'],
    ['Kochi', 'Kerala', '682016', '40/1120, MG Road, Ernakulam'],
    ['Indore', 'Madhya Pradesh', '452010', '88, Vijay Nagar, Scheme 54'],
    ['Chandigarh', 'Chandigarh', '160022', 'House 1122, Sector 21-B'],
    ['Patna', 'Bihar', '800001', '16, Boring Road'],
    ['Guwahati', 'Assam', '781005', 'Lachit Nagar, GS Road'],
    ['Bhubaneswar', 'Odisha', '751015', 'N-3/215, IRC Village, Nayapalli']
  ];

  var NAMES = ['Priya Iyer', 'Aarav Sharma', 'Rohan Mehta', 'Ananya Reddy', 'Vikram Singh', 'Sneha Kulkarni',
    'Arjun Nair', 'Kavya Menon', 'Rahul Gupta', 'Isha Patel', 'Aditya Joshi', 'Meera Pillai', 'Karan Malhotra',
    'Pooja Desai', 'Siddharth Rao', 'Neha Agarwal', 'Amit Verma', 'Divya Krishnan', 'Manish Chauhan',
    'Riya Banerjee', 'Tanvi Shah', 'Nikhil Jain', 'Shruti Mishra', 'Farhan Qureshi', 'Gurpreet Kaur',
    'Abhishek Das', 'Lakshmi Subramanian', 'Varun Kapoor', 'Zoya Khan', 'Harsh Vardhan'];

  var STATE_CODES = { 'Maharashtra': '27', 'Delhi': '07', 'Haryana': '06', 'Karnataka': '29', 'Tamil Nadu': '33',
    'Telangana': '36', 'West Bengal': '19', 'Gujarat': '24', 'Rajasthan': '08', 'Uttar Pradesh': '09', 'Kerala': '32',
    'Madhya Pradesh': '23', 'Chandigarh': '04', 'Bihar': '10', 'Assam': '18', 'Odisha': '21', 'Punjab': '03',
    'Chhattisgarh': '22', 'Goa': '30', 'Jharkhand': '20', 'Uttarakhand': '05', 'Himachal Pradesh': '02', 'Jammu and Kashmir': '01' };

  var WAREHOUSES = [
    { id: 'wh-mum', code: 'MUM', name: 'Mumbai (Bhiwandi)', city: 'Bhiwandi', state: 'Maharashtra', address: 'Gala 14, Rahnal Village, Bhiwandi, Thane 421302', manager: 'Suresh Yadav' },
    { id: 'wh-del', code: 'DEL', name: 'Delhi NCR (Gurugram)', city: 'Gurugram', state: 'Haryana', address: 'Plot 88, Sector 37, Pace City II, Gurugram 122001', manager: 'Deepak Rawat' },
    { id: 'wh-blr', code: 'BLR', name: 'Bengaluru', city: 'Bengaluru', state: 'Karnataka', address: 'No. 21, KIADB Industrial Area, Hoskote 562114', manager: 'Manjunath Gowda' }
  ];

  var PLANS = [
    { id: 'basic', name: 'Basic', price: 999, tagline: 'For new sellers getting started',
      limits: { products: '500', staff: '2', warehouses: '1', stores: '1', txnFee: '2%' } },
    { id: 'pro', name: 'Pro', price: 2499, tagline: 'For growing D2C brands', popular: true,
      limits: { products: '5,000', staff: '10', warehouses: '3', stores: '3', txnFee: '1%' } },
    { id: 'enterprise', name: 'Enterprise', price: 7999, tagline: 'For multi-brand, multi-warehouse businesses',
      limits: { products: 'Unlimited', staff: 'Unlimited', warehouses: 'Unlimited', stores: '5', txnFee: '0.5%' } }
  ];
  // [feature, basic, pro, enterprise]
  var PLAN_FEATURES = [
    ['Online storefront + custom subdomain', true, true, true],
    ['UPI, Card & COD payments', true, true, true],
    ['GST invoices (CGST/SGST/IGST)', true, true, true],
    ['Coupons & discounts', true, true, true],
    ['Inventory across multiple warehouses', false, true, true],
    ['Purchase orders & suppliers', false, true, true],
    ['Expenses & P&L accounting', false, true, true],
    ['Reports with CSV/PDF export', 'Basic', true, true],
    ['Staff roles & permissions', false, true, true],
    ['Custom domain', false, true, true],
    ['Shiprocket / Delhivery integration', false, true, true],
    ['Multi-store (tenants)', false, false, true],
    ['API access & webhooks', false, false, true],
    ['Dedicated account manager', false, false, true]
  ];

  /* ---------- Tenant catalogs ----------
   * cats: [id, name, emoji, color]
   * products: [catId, name, price, mrp, gst, hsn, sizes, colors, description] */
  var TENANTS = {
    desithreads: {
      name: 'Desi Threads', subdomain: 'desithreads', plan: 'pro', prefix: 'DT', seed: 11, orderCount: 60,
      emoji: '🧵', color: '#7c3aed', tagline: 'Handpicked Indian fashion, home & gourmet — delivered pan-India',
      legalName: 'Desi Threads Retail Pvt. Ltd.', gstin: '27AAGCD4821M1Z3', state: 'Maharashtra',
      address: 'Unit 405, Kamala Mills Compound, Lower Parel, Mumbai 400013', domain: 'desithreads.in',
      phone: '+91 22 4012 8890',
      cats: [
        ['ethnic', 'Ethnic Wear', '🥻', '#db2777'], ['mens', "Men's Fashion", '👔', '#2563eb'],
        ['footwear', 'Footwear', '👟', '#ea580c'], ['electronics', 'Electronics Accessories', '🎧', '#0891b2'],
        ['kitchen', 'Home & Kitchen', '🍳', '#65a30d'], ['beauty', 'Beauty & Ayurveda', '🌿', '#059669'],
        ['grocery', 'Grocery & Spices', '🌶️', '#dc2626'], ['crafts', 'Handicrafts', '🏺', '#b45309']
      ],
      products: [
        ['ethnic', 'Jaipuri Cotton Anarkali Kurta', 1299, 2499, 12, '6204', 'S,M,L,XL,XXL', 'Indigo,Mustard', 'Hand block-printed Jaipuri cotton with a flared anarkali silhouette and three-quarter sleeves.'],
        ['ethnic', 'Banarasi Silk Saree', 6499, 9999, 12, '5007', '', 'Maroon,Royal Blue', 'Pure Banarasi silk with zari buttis and a rich pallu, comes with unstitched blouse piece.'],
        ['ethnic', 'Lucknowi Chikankari Kurti', 899, 1599, 5, '6206', 'S,M,L,XL', 'White,Powder Pink', 'Delicate hand chikankari on breathable georgette-cotton, straight fit.'],
        ['ethnic', 'Kanjeevaram Silk Saree', 12999, 18500, 12, '5007', '', 'Temple Gold,Emerald', 'Handwoven Kanjeevaram with contrast border and silk mark certification.'],
        ['ethnic', 'Bandhani Georgette Dupatta', 549, 999, 5, '6214', '', 'Red,Green,Yellow', 'Traditional Kutchi bandhani tie-dye on soft georgette, 2.25 m.'],
        ['mens', 'Cotton Nehru Jacket', 1799, 2999, 12, '6203', 'S,M,L,XL', 'Charcoal,Beige', 'Structured Nehru jacket in textured cotton, pairs with kurtas or shirts.'],
        ['mens', 'Linen Blend Formal Shirt', 1149, 1899, 12, '6205', '38,40,42,44', 'Sky Blue,White', 'Breathable linen-cotton shirt, regular fit, perfect for Indian summers.'],
        ['mens', 'Slim Fit Stretch Chinos', 1399, 2299, 12, '6203', '30,32,34,36', 'Khaki,Navy,Olive', 'Everyday chinos with 2% stretch and a tapered leg.'],
        ['mens', 'Silk Blend Kurta Pyjama Set', 2499, 3999, 12, '6203', 'S,M,L,XL', 'Ivory,Maroon', 'Festive kurta pyjama set with mandarin collar — Diwali and wedding ready.'],
        ['mens', 'Printed Cotton Polo T-Shirt', 599, 999, 5, '6105', 'S,M,L,XL', 'Navy,Bottle Green', 'Soft 220 GSM pique cotton polo with subtle ajrakh print.'],
        ['footwear', 'Kolhapuri Leather Chappal', 899, 1499, 5, '6403', '6,7,8,9,10', 'Tan,Dark Brown', 'GI-tagged hand-stitched Kolhapuri in vegetable-tanned leather.'],
        ['footwear', 'Handcrafted Punjabi Jutti', 1199, 1999, 12, '6403', '5,6,7,8', 'Gold,Maroon', 'Embroidered Punjabi jutti with cushioned insole.'],
        ['footwear', 'AirFlex Running Shoes', 2799, 4499, 12, '6404', '7,8,9,10,11', 'Black,Grey', 'Lightweight mesh runners with EVA midsole for daily 5K runs.'],
        ['footwear', "Women's Block Heel Sandals", 1499, 2499, 12, '6402', '4,5,6,7', 'Nude,Black', 'Comfortable 2.5 inch block heel with padded straps.'],
        ['footwear', 'Classic Canvas Sneakers', 999, 1799, 5, '6404', '6,7,8,9,10', 'White,Navy', 'Timeless low-top canvas sneakers with vulcanised sole.'],
        ['electronics', 'Wireless Earbuds Pro X (TWS)', 1799, 3999, 18, '8518', '', 'Black,White', 'ENC calls, 40 hr playback with case, Type-C fast charging.'],
        ['electronics', '20000mAh Power Bank', 1499, 2499, 18, '8507', '', 'Black', '22.5W fast charge, dual output, BIS certified.'],
        ['electronics', '65W GaN Fast Charger', 1999, 3499, 18, '8504', '', 'White', 'Charges laptop, phone and earbuds together; compact GaN design.'],
        ['electronics', 'Braided USB-C Cable 1.5m', 349, 699, 18, '8544', '', 'Grey,Red', 'Nylon braided 60W cable tested for 20,000 bends.'],
        ['electronics', 'Smartwatch Fit 2', 2999, 5999, 18, '8517', '', 'Black,Rose Gold', '1.8" AMOLED, SpO2, BT calling and 7-day battery.'],
        ['kitchen', '5L Stainless Steel Pressure Cooker', 2199, 3150, 12, '7323', '', '', 'Induction-base triply pressure cooker with ISI mark.'],
        ['kitchen', 'Cast Iron Dosa Tawa 12"', 1099, 1650, 12, '7321', '', '', 'Pre-seasoned cast iron tawa for crisp dosas and rotis.'],
        ['kitchen', 'Pure Copper Water Bottle 1L', 799, 1299, 12, '7418', '', 'Hammered,Plain', 'Ayurvedic tamra bottle with leak-proof cap.'],
        ['kitchen', 'Non-stick Kadai with Glass Lid', 1349, 2100, 12, '7615', '', '', '24 cm granite-coated kadai, PFOA free.'],
        ['kitchen', 'Mixer Grinder 750W', 3499, 5200, 18, '8509', '', 'White,Red', '3 jars, 5-year motor warranty, overload protection.'],
        ['beauty', 'Kumkumadi Face Oil 30ml', 899, 1250, 18, '3304', '', '', 'Saffron-infused Ayurvedic night serum for radiant skin.'],
        ['beauty', 'Neem Tulsi Face Wash 150ml', 249, 350, 18, '3304', '', '', 'Soap-free purifying face wash for oily skin.'],
        ['beauty', 'Bhringraj Hair Oil 200ml', 399, 550, 18, '3305', '', '', 'Cold-pressed sesame base with bhringraj and amla.'],
        ['beauty', 'Haldi Chandan Ubtan Face Pack', 349, 499, 18, '3304', '', '', 'Traditional besan, haldi and chandan ubtan for glow.'],
        ['beauty', 'Ashwagandha Capsules (60)', 499, 699, 12, '3004', '', '', 'KSM-66 ashwagandha root extract, 500 mg per capsule.'],
        ['grocery', 'Darjeeling First Flush Tea 250g', 649, 899, 5, '0902', '', '', 'Spring-plucked muscatel from a Kurseong estate, whole leaf.'],
        ['grocery', 'Kashmiri Mongra Saffron 1g', 349, 450, 5, '0910', '', '', 'Grade A1 Pampore saffron, GI tagged.'],
        ['grocery', 'Stone-ground Garam Masala 200g', 179, 220, 5, '0910', '', '', 'Small-batch blend of 14 whole spices, no fillers.'],
        ['grocery', 'Malabar Black Pepper 250g', 299, 380, 5, '0904', '', '', 'Bold Tellicherry garbled pepper from Wayanad farms.'],
        ['grocery', 'A2 Desi Cow Ghee 1L', 1099, 1350, 12, '0405', '', '', 'Bilona-churned A2 Gir cow ghee, glass jar.'],
        ['crafts', 'Madhubani Painting (A3)', 2499, 3999, 12, '9701', '', '', 'Original hand-painted Madhubani on handmade paper by Bihar artisans.'],
        ['crafts', 'Jaipur Blue Pottery Vase', 1299, 1999, 12, '6913', '', 'Blue,Turquoise', 'Quartz-based blue pottery with Persian floral motifs.'],
        ['crafts', 'Dhokra Brass Figurine', 1899, 2799, 12, '8306', '', '', 'Lost-wax cast Dhokra tribal art from Bastar.'],
        ['crafts', 'Channapatna Wooden Toy Set', 799, 1199, 12, '9503', '', '', 'Lac-coloured, non-toxic wooden toys from Karnataka.'],
        ['crafts', 'Kashmiri Pashmina Shawl', 5999, 8999, 12, '6214', '', 'Natural,Maroon,Teal', 'Handspun Changthangi pashmina with sozni embroidery.']
      ],
      suppliers: [
        ['Jaipur Textiles Pvt. Ltd.', 'Ramesh Agarwal', 'Jaipur', 'Rajasthan', '08AABCJ1234K1Z5', 'ethnic'],
        ['Surat Silk Mills', 'Hitesh Patel', 'Surat', 'Gujarat', '24AADFS5621L1Z8', 'mens'],
        ['Agra Footwear Co.', 'Imran Qureshi', 'Agra', 'Uttar Pradesh', '09AAFCA7788C1Z2', 'footwear'],
        ['Nehru Place Electronics Traders', 'Sanjay Bansal', 'New Delhi', 'Delhi', '07AAHFN3345P1ZQ', 'electronics'],
        ['Kerala Ayur Naturals', 'Dr. Anil Kumar', 'Kochi', 'Kerala', '32AACCK9087R1Z6', 'beauty'],
        ['Darjeeling Tea Estates Co-op', 'Pemba Sherpa', 'Darjeeling', 'West Bengal', '19AABAD2231M1ZV', 'grocery']
      ]
    },
    masalabox: {
      name: 'Masala Box', subdomain: 'masalabox', plan: 'basic', prefix: 'MB', seed: 29, orderCount: 48,
      emoji: '🌶️', color: '#dc2626', tagline: 'Farm-fresh spices, teas & pantry staples from across India',
      legalName: 'Masala Box Foods LLP', gstin: '29AAPFM6612Q1Z9', state: 'Karnataka',
      address: '2nd Floor, 88 Residency Road, Bengaluru 560025', domain: 'masalabox.in',
      phone: '+91 80 4718 2200',
      cats: [
        ['spices', 'Whole & Ground Spices', '🌶️', '#dc2626'], ['tea', 'Tea & Coffee', '🍵', '#15803d'],
        ['dryfruits', 'Dry Fruits & Ghee', '🥜', '#a16207'], ['kitchenware', 'Kitchenware', '🥘', '#475569'],
        ['hampers', 'Gift Hampers', '🎁', '#9333ea']
      ],
      products: [
        ['spices', 'Kashmiri Red Chilli Powder 200g', 199, 260, 5, '0904', '', '', 'Vibrant colour, mild heat — sun-dried Kashmiri chillies.'],
        ['spices', 'Lakadong Turmeric 250g', 249, 320, 5, '0910', '', '', 'Meghalaya Lakadong turmeric with 7%+ curcumin.'],
        ['spices', 'Royal Garam Masala 100g', 159, 199, 5, '0910', '', '', 'Heirloom Awadhi blend with black cardamom and mace.'],
        ['spices', 'Chettinad Sambar Powder 200g', 179, 230, 5, '0910', '', '', 'Roasted lentil-spice blend from Karaikudi.'],
        ['spices', 'Pure Hing (Asafoetida) 50g', 299, 399, 5, '1301', '', '', 'Strong compounded hing from Hathras.'],
        ['spices', 'Green Cardamom Bold 100g', 449, 560, 5, '0908', '', '', '8mm bold Idukki elaichi, hand-sorted.'],
        ['tea', 'Darjeeling Muscatel Tea 250g', 899, 1150, 5, '0902', '', '', 'Second flush muscatel from Castleton region.'],
        ['tea', 'Assam CTC Tea 500g', 349, 420, 5, '0902', '', '', 'Strong malty CTC for the perfect kadak chai.'],
        ['tea', 'Nilgiri Green Tea 100g', 399, 499, 5, '0902', '', '', 'Whole-leaf green tea from high-grown Nilgiri estates.'],
        ['tea', 'Coorg Filter Coffee 500g', 549, 650, 5, '0901', '', '80:20,100% Coffee', 'Peaberry-plantation blend with chicory, medium roast.'],
        ['dryfruits', 'A2 Gir Cow Ghee 500ml', 649, 799, 12, '0405', '', '', 'Bilona-method ghee in glass jar.'],
        ['dryfruits', 'Kashmiri Walnut Kernels 500g', 899, 1099, 12, '0802', '', '', 'Light halves, freshly shelled.'],
        ['dryfruits', 'Mamra Almonds 250g', 1199, 1450, 12, '0802', '', '', 'Oil-rich Iranian mamra almonds.'],
        ['kitchenware', 'Steel Masala Dabba (7 bowls)', 799, 1199, 12, '7323', '', '', 'Food-grade steel spice box with spoon and glass lid.'],
        ['kitchenware', 'Granite Mortar & Pestle', 699, 999, 12, '6802', '', '', 'Hand-carved granite khalbatta for fresh masalas.'],
        ['kitchenware', 'Brass Chai Kettle 1L', 1499, 2199, 12, '7418', '', '', 'Tin-lined brass kettle, heirloom finish.'],
        ['hampers', 'Diwali Spice Hamper', 1999, 2599, 12, '0910', '', '', '8 bestselling spices in a hand-painted wooden box.'],
        ['hampers', 'Chai Lovers Gift Box', 1499, 1899, 5, '0902', '', '', 'Three teas, chai masala and two kulhads.']
      ],
      suppliers: [
        ['Kerala Spice Board Traders', 'Thomas Mathew', 'Kochi', 'Kerala', '32AAKFK4411H1Z3', 'spices'],
        ['Unjha Spice Co.', 'Mahesh Patel', 'Unjha', 'Gujarat', '24AABCU7722D1Z1', 'spices'],
        ['Assam Tea Gardens Ltd.', 'Bikash Gogoi', 'Dibrugarh', 'Assam', '18AAACA5521E1ZK', 'tea'],
        ['Coorg Coffee Growers', 'Ponnappa K.', 'Madikeri', 'Karnataka', '29AAECC3398F1Z4', 'tea'],
        ['Amritsar Dry Fruits House', 'Harjeet Singh', 'Amritsar', 'Punjab', '03AAGFA1180B1Z7', 'dryfruits'],
        ['Moradabad Metal Crafts', 'Salim Ansari', 'Moradabad', 'Uttar Pradesh', '09AADFM6654G1Z0', 'kitchenware']
      ]
    },
    kaarigar: {
      name: 'Kaarigar Home', subdomain: 'kaarigar', plan: 'enterprise', prefix: 'KH', seed: 47, orderCount: 42,
      emoji: '🏺', color: '#b45309', tagline: 'Artisan-made decor & textiles, direct from Indian craft clusters',
      legalName: 'Kaarigar Home Crafts Pvt. Ltd.', gstin: '07AAKCK3390H1Z2', state: 'Delhi',
      address: 'F-12, Okhla Industrial Area Phase 1, New Delhi 110020', domain: 'kaarigarhome.in',
      phone: '+91 11 4105 6677',
      cats: [
        ['art', 'Folk Art', '🎨', '#c2410c'], ['decor', 'Home Decor', '🪔', '#b45309'],
        ['textiles', 'Handloom Textiles', '🧶', '#be185d'], ['brass', 'Brass & Metal', '🔔', '#a16207']
      ],
      products: [
        ['art', 'Madhubani Fish Painting (A3)', 2499, 3499, 12, '9701', '', '', 'Natural pigments on handmade paper, Mithila region.'],
        ['art', 'Gond Tribal Art Canvas', 3999, 5499, 12, '9701', '', '', 'Signed Gond painting from Patangarh artists.'],
        ['art', 'Pattachitra Scroll', 2899, 3999, 12, '9701', '', '', 'Odisha pattachitra on treated cloth, Krishna Leela.'],
        ['art', 'Warli Wall Plate Set', 999, 1499, 12, '6912', '', '', 'Set of 3 hand-painted terracotta plates.'],
        ['decor', 'Blue Pottery Table Lamp', 2299, 3199, 12, '9405', '', '', 'Jaipur blue pottery base with linen shade.'],
        ['decor', 'Terracotta Diya Set (12)', 449, 699, 5, '6912', '', '', 'Hand-painted Diwali diyas from Kumhar Gram.'],
        ['decor', 'Sheesham Wood Wall Shelf', 1899, 2699, 12, '9403', '', 'Walnut,Natural', 'Solid sheesham floating shelf with brass inlay.'],
        ['decor', 'Channapatna Stacking Toy', 649, 899, 12, '9503', '', '', 'Lac-turned wooden stacker, non-toxic colours.'],
        ['textiles', 'Kantha Stitch Throw', 2499, 3499, 5, '6304', '', 'Indigo,Rust', 'Upcycled cotton saris layered with kantha running stitch.'],
        ['textiles', 'Ikat Cushion Covers (Set of 2)', 899, 1299, 5, '6304', '', 'Teal,Mustard', 'Pochampally ikat handloom, 16x16 in.'],
        ['textiles', 'Ajrakh Cotton Bedsheet (King)', 2199, 2999, 5, '6302', '', '', 'Natural-dye ajrakh from Bhuj with 2 pillow covers.'],
        ['textiles', 'Kashmiri Aari Rug 3x5 ft', 5999, 7999, 12, '5705', '', '', 'Hand-embroidered wool rug in chinar motif.'],
        ['brass', 'Dhokra Tribal Horse', 1799, 2499, 12, '8306', '', '', 'Bastar lost-wax metal casting.'],
        ['brass', 'Brass Urli Bowl 10"', 1599, 2199, 12, '7419', '', '', 'Floating-flower urli for festive decor.'],
        ['brass', 'Temple Bell with Chain', 899, 1199, 12, '8306', '', '', 'Moradabad brass bell with 24" chain.']
      ],
      suppliers: [
        ['Mithila Artisans Collective', 'Sunita Jha', 'Madhubani', 'Bihar', '10AAATM2213J1Z9', 'art'],
        ['Jaipur Blue Pottery House', 'Kripal Singh', 'Jaipur', 'Rajasthan', '08AAEFJ8871K1Z4', 'decor'],
        ['Bastar Dhokra Craft Society', 'Jaydev Baghel', 'Kondagaon', 'Chhattisgarh', '22AAABB4420L1Z6', 'brass'],
        ['Kutch Weavers Guild', 'Vankar Shamji', 'Bhuj', 'Gujarat', '24AAACK9981M1Z3', 'textiles'],
        ['Pochampally Handloom Co-op', 'Ramulu G.', 'Pochampally', 'Telangana', '36AAAAP5540N1Z2', 'textiles'],
        ['Moradabad Brass Works', 'Nadeem Ahmed', 'Moradabad', 'Uttar Pradesh', '09AAGFM7765P1Z8', 'brass']
      ]
    }
  };

  var STAFF = [
    ['Rohit Kapoor', 'Owner'], ['Anjali Mehra', 'Manager'], ['Deepak Rawat', 'Manager'],
    ['Suresh Yadav', 'Staff'], ['Farah Siddiqui', 'Staff'], ['Pallavi Gokhale', 'Staff']
  ];
  var STAFF_TITLES = ['Founder & CEO', 'Store Manager', 'Operations Manager', 'Warehouse Executive', 'Customer Support', 'Catalog Executive'];

  var EXPENSE_PLAN = [ // [category, description, share of total, count]
    ['Rent', 'Warehouse & office rent', 0.20, 3],
    ['Salaries', 'Staff salaries', 0.36, 3],
    ['Shipping', 'Shiprocket shipping charges', 0.14, 6],
    ['Payment Gateway', 'Razorpay payment gateway fees', 0.06, 4],
    ['Marketing', 'Google Ads campaign', 0.08, 3],
    ['Marketing', 'Meta (Instagram) Ads', 0.08, 3],
    ['Packaging', 'Corrugated boxes & poly mailers', 0.04, 2],
    ['Utilities', 'Electricity & broadband', 0.02, 1],
    ['Software', 'ShopMint subscription', 0.02, 0]
  ];

  function iso(ts) { return new Date(ts).toISOString(); }
  function round(n, to) { return Math.round(n / to) * to; }
  function slug(s) { return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }

  function seed(tid) {
    var T = TENANTS[tid];
    if (!T) throw new Error('Unknown tenant ' + tid);
    var r = rng(T.seed);
    var pick = function (arr) { return arr[Math.floor(r() * arr.length)]; };
    var int = function (a, b) { return a + Math.floor(r() * (b - a + 1)); };
    var now = Date.now();

    var categories = T.cats.map(function (c) { return { id: c[0], name: c[1], emoji: c[2], color: c[3], description: c[1] + ' handpicked by the ' + T.name + ' team' }; });
    var catById = {};
    categories.forEach(function (c) { catById[c.id] = c; });

    var catCounters = {};
    var products = T.products.map(function (p, i) {
      var cat = catById[p[0]];
      catCounters[p[0]] = (catCounters[p[0]] || 0) + 1;
      var stockByWh = {};
      WAREHOUSES.forEach(function (w, wi) {
        var q = int(4, 45);
        if (wi === 2 && r() < 0.4) q = 0;
        stockByWh[w.id] = q;
      });
      if (i % 9 === 4) { stockByWh['wh-mum'] = int(2, 5); stockByWh['wh-del'] = int(0, 3); stockByWh['wh-blr'] = 0; } // low stock
      if (i % 17 === 8) { stockByWh['wh-mum'] = 0; stockByWh['wh-del'] = 0; stockByWh['wh-blr'] = 0; } // out of stock
      var total = 0; for (var k in stockByWh) total += stockByWh[k];
      return {
        id: 'p' + (i + 1),
        name: p[1],
        sku: T.prefix + '-' + p[0].slice(0, 3).toUpperCase() + '-' + String(100 + catCounters[p[0]]).slice(0),
        hsn: p[5], gst: p[4], categoryId: p[0],
        price: p[2], mrp: p[3], cost: round(p[2] * (0.42 + r() * 0.14), 10),
        stock: total, stockByWh: stockByWh,
        variants: { sizes: p[6] ? p[6].split(',') : [], colors: p[7] ? p[7].split(',') : [] },
        color: cat.color, emoji: cat.emoji,
        featured: i % 5 === 0 || i % 7 === 3,
        rating: Math.round((3.8 + r() * 1.1) * 10) / 10, reviews: int(12, 480),
        description: p[8], slug: slug(p[1]), active: true
      };
    });

    var customers = [];
    for (var ci = 0; ci < 25; ci++) {
      var nm = NAMES[(ci + T.seed) % NAMES.length];
      var city = CITIES[(ci * 7 + T.seed) % CITIES.length];
      var first = nm.split(' ')[0].toLowerCase(), last = nm.split(' ').slice(-1)[0].toLowerCase();
      customers.push({
        id: 'c' + (ci + 1), name: nm,
        email: first + '.' + last + (ci % 3 === 0 ? int(1, 99) : '') + '@' + pick(['gmail.com', 'gmail.com', 'yahoo.co.in', 'outlook.com', 'rediffmail.com']),
        phone: '+91 ' + pick(['98', '97', '99', '88', '70', '63', '91']) + int(100, 999) + ' ' + int(10000, 99999),
        line: city[3], city: city[0], state: city[1], pincode: city[2],
        joined: iso(now - int(95, 420) * DAY), notes: ''
      });
    }

    // Orders: spread over last 90 days, newest statuses reflect age
    var orders = [];
    var orderTimes = [];
    for (var oi = 0; oi < T.orderCount; oi++) orderTimes.push(now - Math.pow(r(), 1.15) * 89 * DAY - int(1, 600) * 60000);
    orderTimes.sort(function (a, b) { return a - b; });
    var couponUse = { WELCOME10: 0, FESTIVE15: 0, FIRST200: 0, DIWALI500: 0 };
    orderTimes.forEach(function (ts, n) {
      var cust = customers[Math.floor(Math.pow(r(), 1.3) * customers.length)];
      var lineCount = r() < 0.55 ? 1 : (r() < 0.7 ? 2 : 3);
      var items = [], used = {};
      for (var li = 0; li < lineCount; li++) {
        var p = products[Math.floor(r() * products.length)];
        if (used[p.id]) continue;
        used[p.id] = 1;
        var variant = [p.variants.sizes.length ? pick(p.variants.sizes) : '', p.variants.colors.length ? pick(p.variants.colors) : ''].filter(Boolean).join(' / ');
        items.push({ productId: p.id, name: p.name, sku: p.sku, hsn: p.hsn, gst: p.gst, qty: r() < 0.78 ? 1 : 2, price: p.price, cost: p.cost, variant: variant });
      }
      var subtotal = items.reduce(function (s, it) { return s + it.price * it.qty; }, 0);
      var coupon = '', discount = 0;
      var cr = r();
      if (cr < 0.08 && subtotal >= 499) { coupon = 'WELCOME10'; discount = Math.min(Math.round(subtotal * 0.10), 500); }
      else if (cr < 0.14 && subtotal >= 1999) { coupon = 'FESTIVE15'; discount = Math.min(Math.round(subtotal * 0.15), 1500); }
      else if (cr < 0.18 && subtotal >= 999) { coupon = 'FIRST200'; discount = 200; }
      else if (cr < 0.21 && subtotal >= 2999) { coupon = 'DIWALI500'; discount = 500; }
      if (coupon) couponUse[coupon]++;
      var payment = cr > 0.75 ? 'COD' : (cr > 0.5 ? 'Card' : 'UPI');
      var express = r() < 0.2;
      var shipping = express ? 149 : (subtotal - discount >= 999 ? 0 : 79);
      var codFee = payment === 'COD' ? 49 : 0;
      var total = subtotal - discount + shipping + codFee;
      var ratio = subtotal ? (subtotal - discount) / subtotal : 1;
      var tax = items.reduce(function (s, it) { return s + it.price * it.qty * ratio * it.gst / (100 + it.gst); }, 0);
      var age = (now - ts) / DAY;
      var status = age < 2.5 ? 'pending' : age < 6 ? (r() < 0.3 ? 'pending' : 'shipped') : (r() < 0.09 ? 'returned' : (r() < 0.05 ? 'shipped' : 'delivered'));
      var history = [{ status: 'pending', at: iso(ts), note: 'Order placed' }];
      if (status !== 'pending') history.push({ status: 'shipped', at: iso(ts + int(1, 2) * DAY), note: 'Shipped via ' + (express ? 'Blue Dart' : pick(['Delhivery', 'Ekart', 'Xpressbees'])) + ' · AWB ' + int(1000000, 9999999) + int(100, 999) });
      if (status === 'delivered' || status === 'returned') history.push({ status: 'delivered', at: iso(ts + int(3, 6) * DAY), note: 'Delivered' });
      if (status === 'returned') history.push({ status: 'returned', at: iso(ts + int(8, 12) * DAY), note: pick(['Size issue — customer returned', 'Damaged in transit', 'Customer changed mind']) });
      var wh = cust.state === 'Karnataka' || cust.state === 'Tamil Nadu' || cust.state === 'Kerala' || cust.state === 'Telangana' ? 'wh-blr'
        : (['Delhi', 'Haryana', 'Uttar Pradesh', 'Chandigarh', 'Rajasthan', 'Bihar'].indexOf(cust.state) >= 0 ? 'wh-del' : 'wh-mum');
      orders.push({
        id: T.prefix + (10231 + n), date: iso(ts), customerId: cust.id,
        items: items, subtotal: subtotal, discount: discount, coupon: coupon,
        shipping: shipping, shippingMethod: express ? 'express' : 'standard', codFee: codFee,
        tax: Math.round(tax * 100) / 100, total: total, status: status,
        payment: payment, paymentStatus: payment === 'COD' && status !== 'delivered' ? 'Pending' : (status === 'returned' ? 'Refunded' : 'Paid'),
        address: { name: cust.name, line: cust.line, city: cust.city, state: cust.state, pincode: cust.pincode, phone: cust.phone },
        email: cust.email, warehouseId: wh, history: history
      });
    });

    var coupons = [
      ['WELCOME10', 'percent', 10, 499, 500, true, 120, 'Welcome offer — 10% off first order (max ₹500)'],
      ['FESTIVE15', 'percent', 15, 1999, 1500, true, 45, 'Festive season sale — 15% off (max ₹1,500)'],
      ['FIRST200', 'flat', 200, 999, 0, true, 60, 'Flat ₹200 off on orders above ₹999'],
      ['DIWALI500', 'flat', 500, 2999, 0, true, 30, 'Diwali dhamaka — flat ₹500 off above ₹2,999'],
      ['MONSOON20', 'percent', 20, 1499, 800, false, -20, 'Monsoon sale (ended)'],
      ['STAFF25', 'percent', 25, 0, 2000, false, 365, 'Internal staff discount — disabled']
    ].map(function (c, i) {
      return { id: 'cp' + (i + 1), code: c[0], type: c[1], value: c[2], minOrder: c[3], maxDiscount: c[4],
        active: c[5], expiry: iso(now + c[6] * DAY).slice(0, 10), uses: (couponUse[c[0]] || 0) + (c[0] === 'MONSOON20' ? 38 : 0), description: c[7] };
    });

    var suppliers = T.suppliers.map(function (s, i) {
      return { id: 's' + (i + 1), name: s[0], contact: s[1], city: s[2], state: s[3], gstin: s[4], categoryId: s[5],
        phone: '+91 ' + int(70000, 99999) + ' ' + int(10000, 99999),
        email: 'orders@' + slug(s[0]).split('-').slice(0, 2).join('') + '.in', paymentTerms: pick(['Net 15', 'Net 30', 'Advance', 'Net 45']) };
    });

    var purchaseOrders = [];
    for (var pi = 0; pi < 10; pi++) {
      var sup = suppliers[pi % suppliers.length];
      var pool = products.filter(function (p) { return p.categoryId === sup.categoryId; });
      if (!pool.length) pool = products;
      var poItems = [], seen = {};
      var nItems = int(1, 3);
      for (var k = 0; k < nItems; k++) {
        var pp = pool[Math.floor(r() * pool.length)];
        if (seen[pp.id]) continue; seen[pp.id] = 1;
        poItems.push({ productId: pp.id, name: pp.name, qty: round(int(10, 60), 5), cost: pp.cost });
      }
      var pdate = now - (82 - pi * 8 - int(0, 3)) * DAY;
      var received = pi < 7;
      purchaseOrders.push({
        id: 'PO-' + T.prefix + '-' + (2401 + pi), supplierId: sup.id, date: iso(pdate),
        expectedDate: iso(pdate + int(5, 12) * DAY), warehouseId: WAREHOUSES[pi % 3].id,
        items: poItems, total: poItems.reduce(function (s, it) { return s + it.qty * it.cost; }, 0),
        status: received ? 'received' : 'ordered', receivedDate: received ? iso(pdate + int(4, 9) * DAY) : null,
        notes: received ? '' : 'Awaiting dispatch from supplier'
      });
    }

    // Expenses scaled to ~60% of 90-day gross profit so the P&L looks like a healthy small business
    var gross = orders.reduce(function (s, o) {
      return o.status === 'returned' ? s : s + (o.subtotal - o.discount - o.tax) - o.items.reduce(function (c, it) { return c + it.cost * it.qty; }, 0);
    }, 0);
    var plan = PLANS.filter(function (p) { return p.id === T.plan; })[0];
    var budget = Math.max(gross * 0.6 - plan.price * 3, gross * 0.3);
    var expenses = [];
    EXPENSE_PLAN.forEach(function (e) {
      if (e[0] === 'Software') {
        for (var m = 0; m < 3; m++) expenses.push([e[0], e[1] + ' (' + plan.name + ')', plan.price, now - (m * 30 + 2) * DAY]);
        return;
      }
      for (var j = 0; j < e[3]; j++) {
        var amt = round(budget * e[2] / e[3] * (0.85 + r() * 0.3), 100);
        var when = e[0] === 'Rent' || e[0] === 'Salaries' ? now - (j * 30 + (e[0] === 'Rent' ? 5 : 1)) * DAY : now - int(1, 88) * DAY;
        expenses.push([e[0], e[1], Math.max(amt, 500), when]);
      }
    });
    expenses.sort(function (a, b) { return b[3] - a[3]; });
    expenses = expenses.map(function (e, i) {
      return { id: 'e' + (i + 1), date: iso(e[3]), category: e[0], description: e[1], amount: e[2],
        paidVia: e[0] === 'Salaries' ? 'Bank Transfer (NEFT)' : e[0] === 'Payment Gateway' ? 'Auto-deducted' : pick(['HDFC Current A/c', 'UPI', 'Corporate Card']) };
    });

    var staff = STAFF.map(function (s, i) {
      var parts = s[0].toLowerCase().split(' ');
      return { id: 'u' + (i + 1), name: s[0], email: parts[0] + '@' + T.domain, role: s[1], title: STAFF_TITLES[i],
        phone: '+91 98' + int(100, 999) + ' ' + int(10000, 99999), active: i !== 5, lastLogin: iso(now - int(0, 72) * 3600000) };
    });

    return {
      version: 1,
      tenant: { id: tid, name: T.name, subdomain: T.subdomain, plan: T.plan },
      settings: {
        storeName: T.name, tagline: T.tagline, logoEmoji: T.emoji, brandColor: T.color,
        subdomain: T.subdomain, customDomain: T.plan === 'basic' ? '' : 'www.' + T.domain,
        currency: 'INR', legalName: T.legalName, gstin: T.gstin, state: T.state, stateCode: STATE_CODES[T.state] || T.gstin.slice(0, 2),
        address: T.address, phone: T.phone, email: 'support@' + T.domain,
        pricesIncludeGst: true, lowStockThreshold: 10,
        payments: { upi: true, card: true, cod: true, netbanking: false },
        codFee: 49, codLimit: 10000,
        shipping: [
          { id: 'standard', name: 'Standard Delivery', days: '4–6 business days', rate: 79, freeAbove: 999, active: true },
          { id: 'express', name: 'Express Delivery', days: '1–2 business days', rate: 149, freeAbove: 0, active: true }
        ],
        billing: { plan: T.plan, cycle: 'monthly', nextBillDate: iso(now + 12 * DAY), card: 'HDFC Visa •••• 4821' }
      },
      categories: categories,
      products: products,
      orders: orders.reverse(), // newest first
      customers: customers,
      coupons: coupons,
      warehouses: WAREHOUSES.map(function (w) { return Object.assign({}, w); }),
      suppliers: suppliers,
      purchaseOrders: purchaseOrders.reverse(),
      expenses: expenses,
      staff: staff,
      currentUserId: 'u1',
      stockMoves: []
    };
  }

  A.data = {
    seed: seed,
    tenants: Object.keys(TENANTS).map(function (id) {
      var T = TENANTS[id];
      return { id: id, name: T.name, subdomain: T.subdomain + '.shopmint.in', plan: T.plan, emoji: T.emoji, color: T.color };
    }),
    plans: PLANS,
    planFeatures: PLAN_FEATURES,
    stateCodes: STATE_CODES,
    states: Object.keys(STATE_CODES).sort(),
    expenseCategories: ['Rent', 'Salaries', 'Shipping', 'Payment Gateway', 'Marketing', 'Packaging', 'Utilities', 'Software', 'Professional Fees', 'Miscellaneous'],
    roles: ['Owner', 'Manager', 'Staff']
  };
})(window.App);
