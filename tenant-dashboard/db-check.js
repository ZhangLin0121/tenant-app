const mongoose = require('mongoose');
const Tenant = require('./models/tenant.model');
const Student = require('./models/student.model');
(async () => {
  await mongoose.connect('mongodb://127.0.0.1:27017/tenantDB', { dbName: 'tenantDB' });
  const tenantCount = await Tenant.countDocuments();
  const studentCount = await Student.countDocuments();
  console.log({ tenantCount, studentCount });
  const sampleTenant = await Tenant.findOne().sort({ updatedAt: -1 }).lean();
  console.log('tenant sample', sampleTenant ? { id: sampleTenant._id, name: sampleTenant.tenantName, updatedAt: sampleTenant.updatedAt } : null);
  const sampleStudent = await Student.findOne().sort({ updatedAt: -1 }).lean();
  console.log('student sample', sampleStudent ? { id: sampleStudent._id, name: sampleStudent.name, tag: sampleStudent.tag, updatedAt: sampleStudent.updatedAt } : null);
  await mongoose.disconnect();
})();
