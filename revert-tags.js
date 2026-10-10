const mongoose = require('./tenant-dashboard/node_modules/mongoose');
const Student = require('./tenant-dashboard/models/student.model');
const Tenant = require('./tenant-dashboard/models/tenant.model');

const AUTO_TAGS = new Set([
  '2022级工程硕博士',
  '2023级工程硕博士',
  '2024级工程硕博士',
  '实习实践'
]);

(async () => {
  await mongoose.connect('mongodb://127.0.0.1:27017/tenantDB', { dbName: 'tenantDB' });

  const studentResult = await Student.updateMany({ tag: { $in: Array.from(AUTO_TAGS) } }, { $set: { tag: '' } });
  const tenantResult = await Tenant.updateMany({ tag: { $in: Array.from(AUTO_TAGS) } }, { $set: { tag: '' } });

  console.log('students cleared:', studentResult.modifiedCount);
  console.log('tenants cleared:', tenantResult.modifiedCount);

  await mongoose.disconnect();
})();
