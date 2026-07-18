/**
 * Initial data for the Inframantra CRM backend.
 * Mirrors the demo set the frontend used to generate in its local seed().
 * Passwords here are PLAINTEXT placeholders and are hashed before insert.
 */

export const USERS = [
  { username: 'admin',     fullName: 'Rohit Saini',          profile: 'System Administrator', role: 'admin',     city: 'All',     manager: null,                    password: 'newRohit@2026#' },
  { username: 'meraj',     fullName: 'Meraj Varid',             profile: 'System Administrator', role: 'admin',     city: 'All',     manager: null,                    password: 'newMeraj@2026#', email: 'meraj@inframantra.com' },
  { username: 'branch',    fullName: 'Saurabh Singh Kushwah',   profile: 'Branch Head',          role: 'branch',    city: 'All',     manager: null,                    password: 'newSaurabh@2026#' },
  { username: 'saleshead', fullName: 'Himanshu Arora',          profile: 'Sales Head',           role: 'saleshead', city: 'All',     manager: null,                    password: 'newHimanshu@2026#' },
  { username: 'cfo',       fullName: 'Sarveshwar',             profile: 'CFO',                  role: 'cfo',       city: 'All',     manager: null,                    password: '123' },
  { username: 'ceo',       fullName: 'Shiwang Suraj',           profile: 'CEO',                  role: 'ceo',       city: 'All',     manager: null,                    password: '123' },
  { username: 'fin',       fullName: 'Priyaanka Gupta',              profile: 'Finance / Management', role: 'finance',   city: 'All',     manager: null,                    password: '123' },
  { username: 'pre',       fullName: 'Neeraj Dagur',            profile: 'Pre-Sales Executive',  role: 'presales',  city: 'Gurgaon', manager: 'Meraj Varid',           password: '123' },
  { username: 'salestl',   fullName: 'Yash Verma',              profile: 'Sales Team Leader',    role: 'sales',     city: 'Noida',   manager: 'Saurabh Singh Kushwah', password: '123' },
  { username: 'sales',     fullName: 'Abhishek Sagar',          profile: 'Sales Executive (RM)', role: 'sales',     city: 'Gurgaon', manager: 'Saurabh Singh Kushwah', password: '123' },
  { username: 'post',      fullName: 'Kunal Verma',             profile: 'Post-Sales Executive', role: 'postsales', city: 'All',     manager: 'Saurabh Singh Kushwah', password: '123' },
  { username: 'ba1',       fullName: 'Rakesh Properties (BA)',  profile: 'Business Associate',   role: 'ba',        city: 'Gurgaon', manager: 'Saurabh Singh Kushwah', password: '123' },
];

export const PROJECTS = [
  {
    name: 'Whiteland Westin Residences', developer: 'Whiteland', sector: 'Sector 103',
    city: 'Gurgaon', locality: 'Dwarka Expressway', status: 'Under Construction',
    description: 'Branded residences on Dwarka Expressway, managed by Marriott.',
    configs: [
      { cfg: '3 BHK', size: '2,400 sq.ft.', price: 38000000 },
      { cfg: '4 BHK', size: '3,200 sq.ft.', price: 52000000 },
    ],
    plans: [{ name: 'CLP', detail: '10 : 80 : 10' }, { name: 'Subvention', detail: '20 : 60 : 20' }],
    fbForms: [{ fid: 'FB-8891023', name: 'Westin Residences Leadgen' }],
  },
  {
    name: 'Elan The Presidential', developer: 'Elan', sector: 'Sector 106',
    city: 'Gurgaon', locality: 'Dwarka Expressway', status: 'Under Construction',
    configs: [
      { cfg: '3 BHK', size: '2,150 sq.ft.', price: 29500000 },
      { cfg: '3 BHK + SR', size: '2,600 sq.ft.', price: 34000000 },
    ],
    plans: [{ name: 'CLP', detail: '15 : 75 : 10' }],
    fbForms: [{ fid: 'FB-7712540', name: 'Presidential Portal Form' }],
  },
  {
    name: 'Godrej Aristocrat', developer: 'Godrej Properties', sector: 'Sector 49',
    city: 'Gurgaon', locality: 'Golf Course Extn / SPR', status: 'Under Construction',
    configs: [
      { cfg: '3 BHK', size: '2,300 sq.ft.', price: 35000000 },
      { cfg: '4 BHK', size: '3,150 sq.ft.', price: 48500000 },
    ],
    plans: [{ name: 'CLP', detail: '10 : 85 : 5' }],
    fbForms: [],
  },
];

// [name, mobile, email, campaign, source, subSource, projectMkt, city, budget, stage, owner, projectIdx]
export const CUSTOMERS = [
  ['Sachin',        '9664569804', '9664569804@99acres.com',   'Property Portal', '99 acres',    'Lead Form',        'Elan The Presidential',        'Gurgaon',   '2 - 3.5 Cr',  'New',          'Neeraj Dagur',   1],
  ['Umang Seth',    '9811865527', 'umangseth22@yahoo.co.in',  'IM_Dwarka_Expy',  'Facebook',    'Click to WhatsApp','Whiteland Westin Residences',  'Gurgaon',   '> 5 Cr',      'Deal Created', 'Abhishek Sagar', 0],
  ['Meera Iyer',    '9899022110', 'meera.iyer@outlook.com',   'IM_Brand_Search', 'Google',      'Landing Page',     'Godrej Aristocrat',            'Delhi',     '3.5 - 5 Cr',  'Deal Created', 'Abhishek Sagar', 2],
  ['Rajeev Khanna', '9971133220', 'rajeev.k@yahoo.com',       'Property Portal', 'Housing.com', 'Channel Partner',  'Elan The Presidential',        'Noida',     '1 - 2 Cr',    'Working',      'Neeraj Dagur',   1],
  ['Sana Qureshi',  '9818844551', 'sana.q@gmail.com',         'IM_Retargeting',  'Facebook',    'Lead Form',        'Godrej Aristocrat',            'Gurgaon',   '> 5 Cr',      'Re-engage',    'Yash Verma',     2],
  ['Deepak Rawat',  '9873366770', 'deepak.rawat@gmail.com',   'Organic',         'Website',     'Chatbot',          '',                             'Faridabad', '< 1 Cr',      'Hold',         'Neeraj Dagur',   0],
];

// Customers (by index) that already have a deal, with their stage.
export const DEALS = [
  { customerIdx: 1, stage: 'Meeting', substatus: 'F2F Scheduled', rm: 'Abhishek Sagar', teamLeader: 'Saurabh Singh Kushwah' },
  { customerIdx: 2, stage: 'Working', substatus: 'Follow up',     rm: 'Abhishek Sagar', teamLeader: 'Saurabh Singh Kushwah' },
];
