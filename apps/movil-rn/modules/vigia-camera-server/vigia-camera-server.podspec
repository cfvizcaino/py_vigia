Pod::Spec.new do |s|
  s.name           = 'vigia-camera-server'
  s.version        = '1.0.0'
  s.summary        = 'VIGIA local MJPEG camera server'
  s.description    = 'Expo native module for the local VIGIA camera server.'
  s.license        = { :type => 'MIT' }
  s.author         = 'VIGIA'
  s.homepage       = 'https://github.com/cfvizcaino/py_vigia'
  s.platforms      = { :ios => '15.1' }
  s.source         = { :git => 'https://github.com/cfvizcaino/py_vigia.git', :tag => s.version.to_s }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = 'ios/**/*.{h,m,mm,swift}'
end
